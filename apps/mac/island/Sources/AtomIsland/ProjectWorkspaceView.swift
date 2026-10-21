import AppKit
import SwiftUI
import AtomIslandCore

/// Read-only local workspace beside the current project chat. File bodies never render as Markdown or HTML.
struct ProjectWorkspaceView: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private var filter: String { get { model.workspace.filter } nonmutating set { model.workspace.filter = newValue } }
    private var selected: WorkspaceChange? { get { model.workspace.selectedChange } nonmutating set { model.workspace.selectedChange = newValue } }
    private var mode: String { get { model.workspace.reviewMode } nonmutating set { model.workspace.reviewMode = newValue } }
    @State private var pieces: [DiffSegment]?
    @State private var confirmingUndo = false

    private var result: WorkspaceResponse? { model.workspace.response }
    private var scope: [String] { ProjectWorkspaceState.identity(model.chats) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if model.workspace.tab == "home" {
                surfaceChooser
            } else if model.workspaceAvailable || model.workspace.tab == "browser" {
                surfaceSelector
                if model.workspace.tab == "browser" {
                    WorkspaceBrowserView(session: model.workspaceBrowser)
                } else if model.workspace.tab == "terminal" {
                    WorkspaceTerminalView(model: model)
                } else {
                if let message = model.workspace.notice {
                    Text(verbatim: message).font(.system(size: 11)).foregroundStyle(theme.text2.color).textSelection(.enabled)
                }
                if model.workspace.pending != nil {
                    ProgressView("Loading workspace…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if model.workspace.tab == "git" {
                    ProjectGitView(model: model)
                } else if let review = result?.review {
                    reviewPane(review)
                } else if let text = result?.text, let path = result?.path {
                    filePane(text, path: path)
                } else if model.workspace.tab == "files" {
                    filesPane
                } else {
                    changesPane
                }
                }
            } else {
                Text("Open an active project chat to browse its folder and review tracked task edits.")
                    .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                Button("Choose a surface") { model.selectWorkspace(nil) }
                    .accessibilityLabel("Choose a workspace surface")
                Spacer()
            }
        }
        .padding(12)
        .foregroundStyle(theme.text.color)
        .buttonStyle(SnapshotBorderlessButtonStyle())
        .frame(minWidth: 260, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.surfaceSolid.color)
        .task(id: scope) {
            guard !snapshot else { return }
            pieces = nil
            model.loadWorkspaceIfNeeded()
        }
        .alert("Undo this file change?", isPresented: $confirmingUndo) {
            Button("Cancel", role: .cancel) {}
            Button("Undo file change", role: .destructive) {
                guard let selected, let review = result?.review, let token = review.token,
                      selected.path == review.path else { return }
                model.requestWorkspace(.undo, path: review.path, job: selected.job, token: token)
            }
        } message: {
            Text("Restore the saved original for this task. For a file created by the task, Undo removes it. Later edits are preserved by refusing Undo.")
        }
        .onChange(of: result?.action) {
            if result?.action == .undo, result?.ok == true { selected = nil; model.requestWorkspace(.changes) }
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Workspace").font(.system(size: 13, weight: .medium))
                Text(verbatim: model.chats?.currentProject?.name ?? "This chat")
                    .font(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(1)
            }
            Spacer(minLength: 4)
            if model.workspace.tab != "browser" && model.workspace.tab != "terminal" {
            Button { selected = nil; model.refreshWorkspace() } label: { Image(systemName: "arrow.clockwise") }
                .help("Refresh workspace").accessibilityLabel("Refresh workspace")
                .disabled(model.workspace.pending != nil || !model.workspaceAvailable || model.workspace.tab == "home" || model.workspace.tab == "browser")
            }
            Button { model.toggleWorkspace() } label: { Image(systemName: "xmark") }
                .help("Close workspace").accessibilityLabel("Close workspace")
        }.buttonStyle(SnapshotBorderlessButtonStyle())
    }

    private var surfaceSelector: some View {
        HStack(spacing: 2) {
            Button { model.selectWorkspace(nil) } label: {
                Image(systemName: "square.grid.2x2").frame(width: 24, height: 28)
            }.buttonStyle(.plain).help("Choose a surface").accessibilityLabel("Choose a workspace surface")
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 2) {
                    ForEach(WorkspaceSurface.allCases, id: \.self) { surface in
                        Button { model.selectWorkspace(surface) } label: {
                            Text(surface.title).fixedSize()
                                .font(.system(size: 12, weight: model.workspace.tab == surface.rawValue ? .medium : .regular))
                                .foregroundStyle(model.workspace.tab == surface.rawValue ? theme.text.color : theme.text3.color)
                                .padding(.horizontal, 8).padding(.vertical, 7)
                                .background(model.workspace.tab == surface.rawValue ? theme.fill2.color : .clear, in: RoundedRectangle(cornerRadius: 6))
                        }.buttonStyle(.plain).disabled(!model.workspaceSurfaceAvailable(surface)).accessibilityLabel("Workspace " + surface.rawValue)
                            .accessibilityAddTraits(model.workspace.tab == surface.rawValue ? .isSelected : [])
                    }
                }.fixedSize(horizontal: true, vertical: false)
                if snapshot {
                    Text((WorkspaceSurface(rawValue: model.workspace.tab)?.title ?? "Surface") + " ▾").font(.system(size: 12)).padding(7)
                } else {
                    Menu {
                        ForEach(WorkspaceSurface.allCases, id: \.self) { surface in
                            Button { model.selectWorkspace(surface) } label: { Label(surface.title, systemImage: surface.symbol) }
                                .disabled(!model.workspaceSurfaceAvailable(surface))
                        }
                    } label: {
                        Text(WorkspaceSurface(rawValue: model.workspace.tab)?.title ?? "Surface").font(.system(size: 12))
                    }.menuStyle(.borderlessButton).fixedSize().accessibilityLabel("Workspace surface")
                }
            }
            Spacer(minLength: 0)
        }.disabled(model.workspace.pending?.action == .undo)
    }

    private var surfaceChooser: some View {
        VStack(alignment: .leading, spacing: 8) {
            Spacer(minLength: 16)
            Text("Open a surface").font(.system(size: 14, weight: .medium)).padding(.bottom, 12)
            ForEach(WorkspaceSurface.allCases, id: \.self) { surface in
                Button { model.selectWorkspace(surface) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: surface.symbol).font(.system(size: 15)).frame(width: 22)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(surface.title).font(.system(size: 13, weight: .medium))
                            Text(surface.detail).font(.system(size: 11)).foregroundStyle(theme.text2.color)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.system(size: 10)).foregroundStyle(theme.text3.color)
                    }.padding(10).contentShape(Rectangle())
                        .background(theme.fill2.color.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                }.buttonStyle(.plain).disabled(!model.workspaceSurfaceAvailable(surface))
                    .accessibilityLabel("Open workspace " + surface.title)
            }
            if !model.workspaceAvailable {
                Text("Files, Changes, Git and Terminal need an active project chat. Browser works beside any chat.")
                    .font(.system(size: 12)).foregroundStyle(theme.text2.color).padding(.top, 8)
            }
            Spacer(minLength: 16)
        }.frame(maxWidth: 380, maxHeight: .infinity, alignment: .leading)
            .frame(maxWidth: .infinity)
    }

    private var filesPane: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if !model.workspace.folder.isEmpty {
                    Button { model.workspace.folder = parent(model.workspace.folder); model.refreshWorkspace() } label: {
                        Label("Up", systemImage: "chevron.up")
                    }.buttonStyle(SnapshotBorderlessButtonStyle())
                }
                Text(verbatim: model.workspace.folder.isEmpty ? "Project folder" : model.workspace.folder)
                    .font(.system(size: 11, design: .monospaced)).lineLimit(2).textSelection(.enabled)
            }
            if snapshot { Text("Filter this folder").font(.system(size: 12)).foregroundStyle(theme.text3.color) }
            else { TextField("Filter this folder", text: Binding(get: { filter }, set: { filter = $0 })).textFieldStyle(.roundedBorder).accessibilityLabel("Filter project folder") }
            Text("Hidden, generated, linked and protected paths are excluded.")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            Scrollable {
                WorkspaceRows(spacing: 3) {
                    let entries = (result?.entries ?? []).filter { filter.isEmpty || $0.name.localizedStandardContains(filter) }
                    if entries.isEmpty {
                        Text(result == nil ? "Refresh to load this folder." : filter.isEmpty ? "No supported files in this folder." : "No matching files.")
                            .font(.system(size: 12)).foregroundStyle(theme.text2.color).padding(.vertical, 12)
                    }
                    ForEach(entries) { entry in
                        Button {
                            filter = ""
                            if entry.directory { model.workspace.folder = entry.path; model.refreshWorkspace() }
                            else { model.requestWorkspace(.read, path: entry.path) }
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: entry.directory ? "folder" : "doc.text").frame(width: 16)
                                Text(verbatim: entry.name).lineLimit(2).multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                                if entry.directory { Image(systemName: "chevron.right").font(.system(size: 9)) }
                            }.font(.system(size: 12)).padding(.horizontal, 7).padding(.vertical, 7).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).accessibilityLabel("\(entry.directory ? "Open folder" : "Preview file") \(entry.name)")
                    }
                }
            }
            if result?.limited == true {
                Text("Folder listing is limited to 300 entries, 128 KiB or 1,000 examined names. Open a smaller folder in Finder for omitted files.")
                    .font(.system(size: 10.5)).foregroundStyle(theme.text2.color)
            }
            Button("Open project in Finder") { revealProject() }.buttonStyle(SnapshotBorderlessButtonStyle()).font(.system(size: 11))
        }
    }

    private var changesPane: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button("Open Git branch review") { model.openWorkspaceBranches() }
                .buttonStyle(SnapshotBorderlessButtonStyle()).font(.system(size: 11))
            Scrollable {
                WorkspaceRows(spacing: 8) {
                    if (result?.changes ?? []).isEmpty {
                        Text(result == nil ? "Refresh to load tracked changes." : "No retained task checkpoints in this project.")
                            .font(.system(size: 12)).foregroundStyle(theme.text2.color).padding(.vertical, 12)
                    }
                    ForEach(result?.changes ?? []) { change in
                        Button {
                            selected = change; pieces = nil; mode = "changes"
                            model.requestWorkspace(.review, path: change.path, job: change.job)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(verbatim: change.path).font(.system(size: 12, weight: .medium)).lineLimit(2)
                                Text(verbatim: "Task #\(change.job) · \(change.task)").font(.system(size: 11)).lineLimit(3)
                                Text(verbatim: "\(change.kind.capitalized) · \(change.state == "ready" ? "Review available" : change.state.capitalized) · \(change.jobState)")
                                    .font(.system(size: 10.5)).foregroundStyle(theme.text2.color)
                                if let reason = change.reason { Text(verbatim: reason).font(.system(size: 11)).foregroundStyle(theme.text2.color) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(9)
                            .background(theme.fill2.color.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
                        }.buttonStyle(.plain).accessibilityLabel("Review \(change.path), task \(change.job), \(change.state)")
                    }
                }
            }
            if result?.limited == true { Text("Showing a bounded selection of the newest tracked files (200 / 256 KiB at most).").font(.system(size: 11)).foregroundStyle(theme.text2.color) }
        }
    }

    private func filePane(_ text: String, path: String) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Button { model.requestWorkspace(.list, path: model.workspace.folder) } label: { Label("Back to files", systemImage: "chevron.left") }
                .buttonStyle(SnapshotBorderlessButtonStyle())
            pathHeader(path)
            fileActions(path)
            Text("Read-only preview · UTF-8 · up to 32 KiB / 1,000 lines")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
            literalText(text)
        }
    }

    private func reviewPane(_ review: WorkspaceReview) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Button { selected = nil; model.requestWorkspace(.changes) } label: { Label("Back to changes", systemImage: "chevron.left") }
                .buttonStyle(SnapshotBorderlessButtonStyle())
            pathHeader(review.path)
            if let selected {
                Text(verbatim: "Task #\(selected.job) · \(selected.task)").font(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(3)
            }
            Text(verbatim: review.note).font(.system(size: 11)).foregroundStyle(theme.text2.color)
            if snapshot {
                HStack { Text("Changes"); Text("Original"); Text("Current") }.font(.system(size: 11)).padding(6).background(theme.fill2.color)
            } else { Picker("Change view", selection: Binding(get: { mode }, set: { mode = $0 })) {
                Text("Changes").tag("changes"); Text("Original").tag("before"); Text("Current").tag("after")
            }.pickerStyle(.segmented) }
            if mode == "changes" {
                Text("Removed text is crossed out; added text is green.").font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                WorkspaceTextScroll {
                    Group {
                        if snapshot { InlineDiffText(pieces: InlineDiff.segments(old: review.before, new: review.after)) }
                        else if let pieces { InlineDiffText(pieces: pieces) }
                        else { ProgressView("Preparing changes…") }
                    }.padding(10).frame(maxWidth: .infinity, alignment: .topLeading)
                }.background(theme.fill2.color.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
            } else { literalText(mode == "before" ? review.before : review.after) }
            fileActions(review.path)
            Button("Undo this file change…") { confirmingUndo = true }
                .disabled(review.token == nil || selected == nil || model.queue.running || model.status.kind != .ready)
                .help(review.token == nil ? review.note : "Review and confirm before restoring the original")
        }
        .task(id: result?.request) {
            pieces = nil
            let value = await Task.detached(priority: .userInitiated) { InlineDiff.segments(old: review.before, new: review.after) }.value
            if !Task.isCancelled { pieces = value }
        }
    }

    private func pathHeader(_ path: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(verbatim: path).font(.system(size: 12, weight: .medium, design: .monospaced)).textSelection(.enabled)
            if let root = result?.root { Text(verbatim: root).font(.system(size: 10.5)).foregroundStyle(theme.text3.color).textSelection(.enabled) }
        }
    }
    private func literalText(_ text: String) -> some View {
        WorkspaceTextScroll {
            Text(verbatim: text.isEmpty ? "(Empty file)" : text)
                .font(.system(size: 11.5, design: .monospaced)).foregroundStyle(theme.text.color)
                .textSelection(.enabled).fixedSize(horizontal: true, vertical: true)
                .frame(maxWidth: .infinity, alignment: .topLeading).padding(10)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(theme.fill2.color.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
    }
    private func fileActions(_ path: String) -> some View {
        HStack(spacing: 12) {
            Button("Add to chat") { model.addWorkspaceFile(path) }
            if snapshot { Text("Open ▾") } else { Menu("Open") {
                Button("Open in editor…") { model.openWorkspaceFile(path, finder: false) }
                Button("Reveal in Finder") { model.openWorkspaceFile(path, finder: true) }
            }.menuStyle(.borderlessButton).fixedSize() }
        }.font(.system(size: 11)).buttonStyle(SnapshotBorderlessButtonStyle())
    }
    private func parent(_ path: String) -> String { path.split(separator: "/").dropLast().joined(separator: "/") }
    private func revealProject() {
        guard !snapshot, let root = ProjectFileNavigation.root(model.chats?.currentProject) else { return }
        NSWorkspace.shared.open(root)
    }
}


/// Keep fixture rendering flat while the live pane retains lazy rows and two-axis scrolling.
struct WorkspaceRows<Content: View>: View {
    let spacing: CGFloat
    @ViewBuilder let content: Content
    @Environment(\.islandSnapshot) private var snapshot
    var body: some View {
        if snapshot { VStack(alignment: .leading, spacing: spacing) { content } }
        else { LazyVStack(alignment: .leading, spacing: spacing) { content } }
    }
}
struct WorkspaceTextScroll<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.islandSnapshot) private var snapshot
    var body: some View {
        if snapshot { Scrollable { content } }
        else { ScrollView([.horizontal, .vertical]) { content }.defaultScrollAnchor(.topLeading) }
    }
}
