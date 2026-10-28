import AppKit
import SwiftUI
import AtomIslandCore

extension IslandModel {
    func openProjectSources() {
        guard projectSource.pending == nil else { return }
        projectSource = ProjectSourceState(); showsProjectSources = true
    }
    func startProjectSource(_ request: ProjectSourceRequest) {
        guard projectSource.pending == nil, canCreateProject else { return }
        projectSource.begin(request); send(.projectCreate(request))
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(135))
            guard let self, self.projectSource.pending?.request == request.request else { return }
            self.send(.projectCreateCancel(request: request.request)); self.projectSource.expire(request.request)
        }
    }
    func cancelProjectSource() {
        guard let request = projectSource.pending?.request, !projectSource.cancelling else { return }
        projectSource.cancelling = true; send(.projectCreateCancel(request: request))
    }
}

struct NewProjectButton: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    var body: some View {
        Button { model.openProjectSources() } label: {
            Image(systemName: "folder.badge.plus").appFont(.system(size: 13)).foregroundStyle(theme.text2.color)
                .frame(width: 28, height: 30).contentShape(Rectangle())
        }.buttonStyle(.plain).help("New project or repository").accessibilityLabel("New project")
            .disabled(model.chats?.projects == nil || model.projectSource.pending != nil)
    }
}

struct ProjectSourceSheet: View {
    let model: IslandModel
    @State private var source: ProjectSource?
    @State private var query = ""
    @State private var cursor = 0
    @State private var name: String
    @State private var folder = ""
    @State private var remote = ""
    @State private var location: URL?
    @FocusState private var searchFocused: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    init(model: IslandModel, source: ProjectSource? = nil, name: String = "", location: URL? = nil) {
        self.model = model; _source = State(initialValue: source); _name = State(initialValue: name); _location = State(initialValue: location)
    }
    private var choices: [ProjectSource] {
        let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
        return ProjectSource.allCases.filter { source in words.allSatisfy { (source.title + " " + source.detail).localizedStandardContains($0) } }
    }
    private var busy: Bool { model.projectSource.pending != nil }
    private var finished: Bool { model.projectSource.response?.ok == true }
    private var folderName: String { folder.isEmpty ? name.trimmingCharacters(in: .whitespacesAndNewlines) : folder }
    private var destination: URL? {
        guard let location else { return nil }
        return source == .folder ? location : location.appendingPathComponent(folderName, isDirectory: true)
    }
    private var valid: Bool {
        model.canCreateProject && source != nil && location != nil && ProjectList.isValidName(name)
            && (source == .folder || ProjectSourceState.validFolder(folderName))
            && ((source != .git && source != .github) || !remote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                if source != nil, !busy, !finished {
                    Button { source = nil; model.projectSource = ProjectSourceState() } label: { Image(systemName: "chevron.left") }
                        .accessibilityLabel("Back to project sources")
                }
                Text(source?.title ?? "New project").appFont(.system(size: 18, weight: .semibold)).accessibilityAddTraits(.isHeader)
                Spacer()
                Button(busy ? "Cancel creation" : finished ? "Done" : "Cancel") {
                    if busy { model.cancelProjectSource() } else { dismiss() }
                }.keyboardShortcut(.cancelAction).disabled(model.projectSource.cancelling)
            }
            if source == nil { chooser }
            else { form }
            if let notice = model.projectSource.notice {
                Text(verbatim: notice).appFont(.system(size: 12)).foregroundStyle(theme.attention.color)
                    .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                if let attempt = model.projectSource.attempt {
                    Text(verbatim: "Attempted folder: " + ProjectList.label(forPath: attempt.path))
                        .appFont(.system(size: 11, design: .monospaced)).foregroundStyle(theme.text2.color)
                        .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                }
            }
            if busy {
                ProgressView(model.projectSource.cancelling ? "Cancelling…" : "Creating project…")
                    .appFont(.system(size: 12)).frame(maxWidth: .infinity, alignment: .leading)
            } else if finished {
                Label("Project added. Your current chat is unchanged.", systemImage: "checkmark.circle")
                    .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
            }
        }
        .padding(22).frame(width: 500, alignment: .leading).foregroundStyle(theme.text.color)
        .background(theme.surfaceSolid.color).buttonStyle(SnapshotBorderlessButtonStyle())
        .interactiveDismissDisabled(busy)
        .onAppear { if !snapshot { searchFocused = true } }
        .onDisappear { if busy { model.cancelProjectSource() } }
    }
    private var chooser: some View {
        VStack(alignment: .leading, spacing: 8) {
            if snapshot { Text("Search sources…").appFont(.system(size: 13)).foregroundStyle(theme.text3.color).padding(.vertical, 6) }
            else {
                TextField("Search sources…", text: $query).textFieldStyle(.plain).focused($searchFocused)
                    .accessibilityLabel("Search project sources").padding(.vertical, 6)
                    .onChange(of: query) { cursor = 0 }
                    .onKeyPress(.downArrow) { cursor = min(max(0, choices.count - 1), cursor + 1); return .handled }
                    .onKeyPress(.upArrow) { cursor = max(0, cursor - 1); return .handled }
                    .onSubmit { if choices.indices.contains(cursor) { source = choices[cursor] } }
            }
            Rectangle().fill(theme.separator.color).frame(height: 1)
            if choices.isEmpty { Text("No matching sources").appFont(.system(size: 12)).foregroundStyle(theme.text2.color).padding(.vertical, 16) }
            ForEach(Array(choices.enumerated()), id: \.element) { index, item in
                Button { source = item } label: {
                    HStack(spacing: 12) {
                        Image(systemName: item.symbol).appFont(.system(size: 15)).frame(width: 22)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.title).appFont(.system(size: 13, weight: .medium))
                            Text(item.detail).appFont(.system(size: 11)).foregroundStyle(theme.text2.color)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").appFont(.system(size: 10)).foregroundStyle(theme.text3.color)
                    }.padding(10).contentShape(Rectangle())
                        .background(index == cursor ? theme.fill2.color : .clear, in: RoundedRectangle(cornerRadius: 7))
                }.accessibilityLabel("Source: " + item.title)
            }
        }
    }
    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            if source == .git || source == .github {
                field("Repository", value: $remote, placeholder: source == .github ? "owner/repository or HTTPS URL" : "https://host/owner/repository.git")
                Text("Public HTTPS repositories only. Sign-in and credential prompts are not supported. Submodules and Git LFS downloads are skipped.")
                    .appFont(.system(size: 11)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
            }
            field("Project name", value: $name, placeholder: "Project name")
            if source != .folder { field("Folder name", value: $folder, placeholder: "Defaults to project name") }
            Button(source == .folder ? "Choose local folder…" : "Choose parent folder…", action: chooseLocation)
                .accessibilityLabel(source == .folder ? "Choose local project folder" : "Choose project parent folder")
            if let destination {
                Text(verbatim: ProjectList.label(forPath: destination.path)).appFont(.system(size: 12, design: .monospaced))
                    .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                Text(ProjectList.grantQuestion(folderLabel: ProjectList.label(forPath: destination.path)))
                    .appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            } else {
                Text(source == .folder ? "Select the existing folder to review its project access." : "A new folder is created inside the selected parent. Existing folders are never overwritten.")
                    .appFont(.system(size: 12)).foregroundStyle(theme.text2.color).fixedSize(horizontal: false, vertical: true)
            }
            if source != .folder {
                Text("Creation is limited to two minutes, about 256 MiB and 20,000 entries. A failed or cancelled attempt can leave a partial folder for you to inspect.")
                    .appFont(.system(size: 11)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                Button(source == .folder ? "Add project" : "Create and add project", action: submit)
                    .keyboardShortcut(.defaultAction).disabled(!valid)
            }
        }.disabled(busy || finished)
    }
    @ViewBuilder private func field(_ label: String, value: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
            if snapshot { Text(value.wrappedValue.isEmpty ? placeholder : value.wrappedValue).appFont(.system(size: 13)).foregroundStyle(theme.text2.color) }
            else { TextField(placeholder, text: value).textFieldStyle(.roundedBorder).accessibilityLabel(label) }
        }
    }
    private func chooseLocation() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.prompt = source == .folder ? "Use folder" : "Use parent folder"
        panel.message = source == .folder ? "Select the folder this project will work in. Review access before adding it." : "Choose where to create a new project folder. Existing folders are never overwritten."
        panel.begin { result in
            guard result == .OK, let url = panel.url else { return }
            Task { @MainActor in
                location = url
                if source == .folder, name.isEmpty { name = (url.path as NSString).lastPathComponent }
            }
        }
    }
    private func submit() {
        guard valid, !busy, !finished, let source, let destination else { return }
        model.startProjectSource(ProjectSourceRequest(source: source, name: name.trimmingCharacters(in: .whitespacesAndNewlines), path: destination.path,
                                                     remote: source == .git || source == .github ? remote.trimmingCharacters(in: .whitespacesAndNewlines) : nil))
    }
}
