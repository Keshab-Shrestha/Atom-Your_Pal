import AppKit
import SwiftUI
import AtomIslandCore

extension IslandModel {
    func openProjectSettings(_ id: String) {
        guard let project = chats?.projects?.first(where: { $0.id == id }) else { return }
        projectError = nil
        projectSettingsProject = project
    }
    var projectSettingsBusy: Bool { projectCommandPending || status.kind != .ready }
}

/// Each setting uses its existing host command and displays the returned catalog; no optimistic permission changes.
struct ProjectSettingsSheet: View {
    let model: IslandModel
    let initial: ProjectInfo
    @State private var name: String
    @State private var confirmingRemoval = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private var project: ProjectInfo? { model.chats?.projects?.first { $0.id == initial.id } }
    init(model: IslandModel, initial: ProjectInfo) {
        self.model = model; self.initial = initial; _name = State(initialValue: initial.name)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Project settings").font(.system(size: 18, weight: .semibold)).accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            if let project {
                if project.archived {
                    Text("Archived project. Unarchive it below to change its settings.")
                        .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                }
                VStack(alignment: .leading, spacing: 8) {
                    heading("Name")
                    HStack {
                        if snapshot { Text(name).font(.system(size: 13)).frame(maxWidth: .infinity, alignment: .leading) }
                        else { TextField("Project name", text: $name).textFieldStyle(.roundedBorder).accessibilityLabel("Project settings name") }
                        Button("Save name") { saveName(project) }
                            .disabled(!ProjectList.isValidName(name) || name.trimmingCharacters(in: .whitespacesAndNewlines) == project.name)
                    }
                }.disabled(model.projectSettingsBusy || project.archived)
                VStack(alignment: .leading, spacing: 6) {
                    heading("Folder")
                    Text(verbatim: project.folderLabel).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    if project.missing { Text("Folder unavailable").font(.system(size: 11)).foregroundStyle(theme.attention.color) }
                    Button("Show in Finder") {
                        guard let current = self.project, let root = ProjectFileNavigation.root(current) else { return }
                        NSWorkspace.shared.activateFileViewerSelecting([root])
                    }.font(.system(size: 12)).disabled(project.missing || project.archived || project.folderLabel.isEmpty)
                    Text("The registered folder stays under the existing project permissions.")
                        .font(.system(size: 11)).foregroundStyle(theme.text3.color)
                }
                VStack(alignment: .leading, spacing: 8) {
                    heading("Default model")
                    if snapshot { Text(modelTitle(project)).font(.system(size: 13)) }
                    else { modelMenu(project) }
                    Text("Used by chats that follow this project's default. Chat overrides and active replies keep their own choice.")
                        .font(.system(size: 11)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: 6) {
                    if snapshot { Text("Allow web search: " + (project.web ? "on" : "off")).font(.system(size: 13)) }
                    else {
                        Toggle("Allow web search", isOn: Binding(get: { self.project?.web ?? false }, set: { value in
                            guard let current = self.project, !current.archived, !model.projectSettingsBusy else { return }
                            model.sendProject(.projectWeb(id: current.id, web: value))
                        })).toggleStyle(.checkbox).disabled(model.projectSettingsBusy || project.archived)
                    }
                    Text("Applies to this project's chats. Chat access modes and tool approvals still apply.")
                        .font(.system(size: 11)).foregroundStyle(theme.text3.color).fixedSize(horizontal: false, vertical: true)
                }
                HStack {
                    Button(project.archived ? "Unarchive project" : "Archive project") {
                        guard let current = self.project, !model.projectSettingsBusy else { return }
                        model.sendProject(.projectArchive(id: current.id, archived: !current.archived))
                    }
                    Spacer()
                    Button("Remove project…", role: .destructive) { confirmingRemoval = true }
                }.font(.system(size: 12)).disabled(model.projectSettingsBusy)
                if model.projectCommandPending { Text("Saving project setting…").font(.system(size: 11)).foregroundStyle(theme.text2.color) }
                if model.projectCommandTarget == initial.id, let error = model.projectError { ProblemLine(text: error) }
            } else {
                Text("This project is no longer available. Your current chat is unchanged.")
                    .font(.system(size: 13)).foregroundStyle(theme.text2.color)
            }
        }
        .padding(22).frame(width: 500, alignment: .leading).foregroundStyle(theme.text.color)
        .background(theme.surfaceSolid.color).buttonStyle(SnapshotBorderlessButtonStyle())
        .confirmationDialog("Remove this project?", isPresented: $confirmingRemoval, titleVisibility: .visible) {
            Button("Remove project, keep chats") { if let project { model.sendProject(.projectRemove(id: project.id, deleteChats: false)) } }
            Button("Also delete its chats", role: .destructive) { if let project { model.sendProject(.projectRemove(id: project.id, deleteChats: true)) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("The folder and its files are not deleted. Keeping chats moves them to the normal list; deleting chats removes their history permanently.") }
        .onChange(of: project?.name) { if let project { name = project.name } }
    }
    private func heading(_ title: String) -> some View {
        Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text2.color)
    }
    private func modelTitle(_ project: ProjectInfo) -> String {
        guard let provider = project.provider, let selected = project.model else { return "Use app default" }
        return (model.modelInfo?.modelName(provider: provider, model: selected) ?? selected) + " · " + provider
    }
    private func modelMenu(_ project: ProjectInfo) -> some View {
        Menu {
            Button { setModel(project, provider: "", selected: "") } label: {
                Label("Use app default", systemImage: project.model == nil ? "checkmark" : "circle")
            }
            if let info = model.modelInfo {
                ForEach(info.providers) { provider in
                    Section(provider.name + (provider.available ? "" : " · unavailable")) {
                        ForEach(provider.models) { option in
                            Button { setModel(project, provider: provider.id, selected: option.id) } label: {
                                Label(option.name, systemImage: project.provider == provider.id && project.model == option.id ? "checkmark" : "circle")
                            }.disabled(!provider.available)
                        }
                    }
                }
            } else { Text("Model catalog unavailable") }
        } label: { Text(modelTitle(project)).font(.system(size: 13)) }
            .accessibilityLabel("Project default model: " + modelTitle(project))
            .disabled(model.projectSettingsBusy || project.archived)
    }
    private func saveName(_ project: ProjectInfo) {
        guard let current = self.project, current.id == project.id, !current.archived,
              !model.projectSettingsBusy, ProjectList.isValidName(name) else { return }
        model.sendProject(.projectRename(id: current.id, name: name.trimmingCharacters(in: .whitespacesAndNewlines)))
    }
    private func setModel(_ project: ProjectInfo, provider: String, selected: String) {
        guard let current = self.project, current.id == project.id, !current.archived, !model.projectSettingsBusy else { return }
        model.sendProject(.projectModel(id: current.id, provider: provider, model: selected))
    }
}
