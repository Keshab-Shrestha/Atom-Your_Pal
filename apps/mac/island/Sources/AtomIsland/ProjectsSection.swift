import AppKit
import SwiftUI
import AtomIslandCore

// ADR-107: Projects in the ATOM window's sidebar, above Chats. A project is a named folder and its chats. Each row opens
// to its chats and a "New chat in <name>" row. Names change in place (double click, or Rename), Return keeps and Esc
// leaves. Everything the runtime refuses shows as one line under the header.

/// Runs a change of what is open: a plain change when Reduce Motion is on, the snap spring otherwise.
@MainActor private func settle(_ reduceMotion: Bool, _ change: () -> Void) {
    if reduceMotion { change() } else { withAnimation(Motion.snap(false), change) }
}

struct ProjectsSection: View {
    let model: IslandModel
    @State private var expanded: Set<String>
    @State private var allChats: Set<String> = []
    @State private var showArchived: Bool
    @State private var renaming: String?
    @State private var draft = ""
    @State private var removing: ProjectInfo?
    @State private var adding: PendingProject?
    @FocusState private var focused: String?
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    /// The folder picked and not yet confirmed.
    struct PendingProject: Identifiable {
        let path: String
        var id: String { path }
        var label: String { ProjectList.label(forPath: path) }
    }

    init(model: IslandModel, expanded: Set<String> = [], showArchived: Bool = false, renaming: String? = nil) {
        self.model = model
        _expanded = State(initialValue: expanded)
        _showArchived = State(initialValue: showArchived)
        _renaming = State(initialValue: renaming)
        _draft = State(initialValue: renaming.flatMap { id in model.chats?.projects?.first { $0.id == id }?.name } ?? "")
    }

    var body: some View {
        if let list = model.chats, list.projectsOn {
            let shown = list.visibleProjects(showArchived: showArchived)
            header
            if let error = model.projectError { ProblemLine(text: error).padding(.horizontal, 10).padding(.vertical, 2) }
            if (list.projects ?? []).isEmpty {
                emptyState
            } else {
                ForEach(shown) { project in projectBlock(project, list: list) }
                if list.archivedCount > 0 { archivedRow(list.archivedCount) }
            }
        }
    }

    // MARK: header and empty state

    private var header: some View {
        HStack {
            Text("Projects").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Button(action: chooseFolder) {
                Label("New project", systemImage: "plus").labelStyle(.iconOnly)
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
                    .frame(width: 20, height: 20).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Make a project from a folder")
            .accessibilityLabel("New project")
        }
        .padding(.horizontal, 10).padding(.top, 8)
        .sheet(item: $adding) { pending in NewProjectSheet(pending: pending) { name in
            model.sendProject(.projectAdd(name: name, path: pending.path))
        } }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("No projects yet. A project gives ATOM a folder to work in across many chats.")
                .font(.system(size: 11.5)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
            QuietButton(title: "New project", symbol: "folder.badge.plus", action: chooseFolder)
        }
        .padding(.horizontal, 10).padding(.vertical, 4)
    }

    private func archivedRow(_ count: Int) -> some View {
        Button { settle(reduceMotion) { showArchived.toggle() } } label: {
            HStack(spacing: 6) {
                Image(systemName: showArchived ? "chevron.down" : "chevron.right").font(.system(size: 8, weight: .bold))
                Text(showArchived ? "Hide archived (\(count))" : "Show archived (\(count))").font(.system(size: 11))
                Spacer(minLength: 0)
            }
            .foregroundStyle(theme.text3.color)
            .padding(.horizontal, 10).padding(.vertical, 4).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(showArchived ? "Hide archived projects" : "Show archived projects")
    }

    // MARK: one project

    @ViewBuilder private func projectBlock(_ project: ProjectInfo, list: ChatList) -> some View {
        let open = expanded.contains(project.id)
        projectRow(project, open: open)
            .confirmationDialog("Remove “\(project.name)”?", isPresented: Binding(get: { removing?.id == project.id }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
                Button("Remove project") { model.sendProject(.projectRemove(id: project.id, deleteChats: false)) }
                Button("Also delete its chats", role: .destructive) { model.sendProject(.projectRemove(id: project.id, deleteChats: true)) }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Removes it from ATOM. Your files and folder are not deleted. Its chats become normal chats.")
            }
        if open {
            let chats = list.chats(in: project.id)
            let more = allChats.contains(project.id)
            VStack(alignment: .leading, spacing: 0) {
                if !project.archived { newChatRow(project) }
                ForEach(ProjectList.shown(chats, all: more)) { chat in
                    SidebarChatRow(model: model, chat: chat, current: chat.id == list.current)
                }
                if chats.count > ProjectList.firstChats && !more {
                    Button { settle(reduceMotion) { _ = allChats.insert(project.id) } } label: {
                        Text("Show more (\(chats.count - ProjectList.firstChats))").font(.system(size: 11)).foregroundStyle(theme.text3.color)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Show more chats in \(project.name)")
                }
            }
            .padding(.leading, 14)
            .transition(reduceMotion ? .identity : .opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
        }
    }

    private func projectRow(_ project: ProjectInfo, open: Bool) -> some View {
        let editing = renaming == project.id
        return HStack(spacing: 8) {
            Image(systemName: "chevron.right").font(.system(size: 8, weight: .bold)).foregroundStyle(theme.text3.color)
                .rotationEffect(.degrees(open ? 90 : 0)).frame(width: 10)
            Image(systemName: "folder").font(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
            VStack(alignment: .leading, spacing: 1) {
                if editing { renameField(project) } else {
                    Text(project.name).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(project.archived ? theme.text3.color : theme.text.color).lineLimit(1)
                }
                if project.missing {
                    Label("Folder not found", systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 10.5)).foregroundStyle(theme.attention.color).lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Text("\(project.chatCount)").font(.system(size: 10.5)).foregroundStyle(theme.text3.color).monospacedDigit()
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .contentShape(Rectangle())
        .focusable()
        .focused($focused, equals: project.id)
        .onTapGesture(count: 2) { if !editing { beginRename(project) } }
        .onTapGesture { if !editing { toggle(project.id) } }
        .onKeyPress(.return) { editing ? .ignored : toggled(project.id) }
        .onKeyPress(.rightArrow) { editing || open ? .ignored : toggled(project.id) }
        .onKeyPress(.leftArrow) { editing || !open ? .ignored : toggled(project.id) }
        .onKeyPress(.delete) { editing ? .ignored : asked(project) }
        .onKeyPress(.deleteForward) { editing ? .ignored : asked(project) }
        .contextMenu { menu(project) }
        .accessibilityElement(children: editing ? .contain : .ignore)
        .accessibilityLabel(project.accessibilityLabel(expanded: open) + (project.missing ? ", folder not found" : ""))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { toggle(project.id) }
        .accessibilityAction(named: "Rename") { beginRename(project) }
    }

    @ViewBuilder private func menu(_ project: ProjectInfo) -> some View {
        Button("Rename") { beginRename(project) }
        Button("Show in Finder") { reveal(project) }
        Toggle("Allow web search", isOn: Binding(get: { project.web }, set: { model.sendProject(.projectWeb(id: project.id, web: $0)) }))
        Button(project.archived ? "Unarchive" : "Archive") { model.sendProject(.projectArchive(id: project.id, archived: !project.archived)) }
        Divider()
        Button("Remove project…", role: .destructive) { removing = project }
    }

    private func newChatRow(_ project: ProjectInfo) -> some View {
        Button {
            model.navigate {
                model.newChat(inProject: project.id)
                model.windowPage = .chat
            }
        } label: {
            Label("New chat in \(project.name)", systemImage: "square.and.pencil")
                .font(.system(size: 12)).foregroundStyle(theme.text2.color).lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10).padding(.vertical, 5).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("New chat in \(project.name)")
    }

    // MARK: actions

    private func toggle(_ id: String) {
        settle(reduceMotion) { if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) } }
    }

    private func toggled(_ id: String) -> KeyPress.Result { toggle(id); return .handled }
    private func asked(_ project: ProjectInfo) -> KeyPress.Result { removing = project; return .handled }

    private func beginRename(_ project: ProjectInfo) {
        draft = project.name
        renaming = project.id
        focused = nil
    }

    /// Return keeps the new name (when it is allowed and changed); Esc leaves it. Focus goes back to the row.
    private func endRename(_ project: ProjectInfo, commit: Bool) {
        let name = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        renaming = nil
        if commit, name != project.name, ProjectList.isValidName(name) { model.sendProject(.projectRename(id: project.id, name: name)) }
        DispatchQueue.main.async { focused = project.id }
    }

    @ViewBuilder private func renameField(_ project: ProjectInfo) -> some View {
        if snapshot {
            // `ImageRenderer` cannot draw a text field: draw it as it would look.
            Text(draft + "|").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                .padding(.horizontal, 4).padding(.vertical, 1)
                .background(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(theme.accent.color, lineWidth: 1))
        } else {
            RenameField(text: $draft, label: "Project name") { endRename(project, commit: true) } onCancel: { endRename(project, commit: false) }
        }
    }

    private func reveal(_ project: ProjectInfo) {
        let url = URL(fileURLWithPath: project.folderPath)
        if FileManager.default.fileExists(atPath: url.path) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            // The folder is gone: show where it was, as far as it exists.
            NSWorkspace.shared.activateFileViewerSelecting([url.deletingLastPathComponent()])
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Use for project"
        panel.message = "Choose the folder this project works in. ATOM reads files only inside it, never secret files such as .env, and changes files only through its agent."
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in adding = PendingProject(path: url.path) }
        }
    }
}

/// A one-line field for a new name: Return keeps, Esc leaves; it takes focus when it appears.
struct RenameField: View {
    @Binding var text: String
    let label: String
    let onCommit: () -> Void
    let onCancel: () -> Void
    @FocusState private var focused: Bool
    @Environment(\.theme) private var theme

    var body: some View {
        TextField(label, text: $text)
            .textFieldStyle(.plain)
            .font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.text.color)
            .focused($focused)
            .onSubmit(onCommit)
            .onExitCommand(perform: onCancel)
            .padding(.horizontal, 4).padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(theme.accent.color, lineWidth: 1))
            .onAppear { focused = true }
            .accessibilityLabel(label)
    }
}

/// The question that comes after the folder is picked: the name, and what ATOM may do in the folder.
private struct NewProjectSheet: View {
    let pending: ProjectsSection.PendingProject
    let create: (String) -> Void
    @State private var name: String
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    init(pending: ProjectsSection.PendingProject, create: @escaping (String) -> Void) {
        self.pending = pending
        self.create = create
        _name = State(initialValue: ProjectList.suggestedName(forFolder: pending.path))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New project").font(.headline).accessibilityAddTraits(.isHeader)
            Text(ProjectList.grantQuestion(folderLabel: pending.label)).fixedSize(horizontal: false, vertical: true)
            TextField("Project name", text: $name).focused($focused).onSubmit(submit).accessibilityLabel("Project name")
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Create", action: submit).keyboardShortcut(.defaultAction).disabled(!ProjectList.isValidName(name))
            }
        }
        .padding(20).frame(width: 380)
        .onAppear { focused = true }
    }

    private func submit() {
        guard ProjectList.isValidName(name) else { return }
        create(name.trimmingCharacters(in: .whitespacesAndNewlines))
        dismiss()
    }
}

/// A chat in the sidebar, under Chats or under its project: a click continues it, the menu renames or deletes it.
struct SidebarChatRow: View {
    let model: IslandModel
    let chat: ChatInfo
    let current: Bool
    @State private var renaming = false
    @State private var draft = ""
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        Button {
            guard !renaming else { return }
            model.navigate {
                if !current { model.send(.chatOpen(id: chat.id)) }
                model.windowPage = .chat
            }
        } label: {
            VStack(alignment: .leading, spacing: 1) {
                if renaming, !snapshot {
                    RenameField(text: $draft, label: "Chat title") { finish(commit: true) } onCancel: { finish(commit: false) }
                } else {
                    Text(chat.title).font(.system(size: 12.5, weight: current ? .semibold : .regular)).foregroundStyle(theme.text.color).lineLimit(1)
                }
                if let at = chat.updatedAt {
                    Text(at, format: .relative(presentation: .named)).font(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous)
                .strokeBorder(current && model.windowPage == .chat ? (theme.isFlat ? theme.border.color : theme.separator.color) : .clear, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if !chat.readOnly { Button("Rename") { draft = chat.title; renaming = true } }
            Button("Delete chat", role: .destructive) { model.send(.chatDelete(id: chat.id)) }
        }
        .accessibilityLabel(current ? "\(chat.title), current chat" : chat.title)
    }

    private func finish(commit: Bool) {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        renaming = false
        if commit, title != chat.title, ProjectList.isValidName(title) { model.send(.chatRename(id: chat.id, title: title)) }
    }
}

/// The chip in the top bar of an open project chat: the project and its folder, and a button that shows the folder.
struct ProjectChip: View {
    let project: ProjectInfo
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: project.missing ? "exclamationmark.triangle.fill" : "folder").font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(project.missing ? theme.attention.color : theme.text3.color)
            Text(project.chipTitle).font(.system(size: 11.5)).foregroundStyle(theme.text2.color).lineLimit(1).truncationMode(.tail)
            Button {
                let url = URL(fileURLWithPath: project.folderPath)
                NSWorkspace.shared.activateFileViewerSelecting([url])
            } label: {
                Image(systemName: "arrow.up.forward.square").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text2.color)
                    .frame(width: 20, height: 20).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Reveal folder")
            .accessibilityLabel("Reveal folder")
        }
        .padding(.leading, 10).padding(.trailing, 4).frame(height: 24)
        .background(Capsule().fill(theme.fill1.color))
        .overlay(Capsule().strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        .accessibilityElement(children: .contain)
    }
}

/// ADR-107: the quiet line over a long chat the model saw only in part.
struct TrimmedNote: View {
    let text: String
    @Environment(\.theme) private var theme

    var body: some View {
        Text(text).font(.system(size: 11)).foregroundStyle(theme.text3.color).lineLimit(1)
            .frame(maxWidth: .infinity).padding(.top, 8)
            .accessibilityLabel(text)
    }
}
