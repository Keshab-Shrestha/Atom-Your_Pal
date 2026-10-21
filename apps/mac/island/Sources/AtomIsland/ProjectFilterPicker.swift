import SwiftUI
import AtomIslandCore

struct ProjectFilterButton: View {
    let model: IslandModel
    @State private var presented = false
    @Environment(\.theme) private var theme
    var body: some View {
        Button { presented.toggle() } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 12)).foregroundStyle(theme.text2.color)
                .frame(width: 28, height: 30)
                .background(model.sidebarProjectFilter == nil ? .clear : theme.fill2.color, in: RoundedRectangle(cornerRadius: 6))
        }.buttonStyle(.plain).help("Choose a project. Search still covers all content.")
            .accessibilityLabel("Projects").accessibilityIdentifier("projects.filter")
            .disabled(model.chats?.projects == nil)
            .popover(isPresented: $presented, arrowEdge: .bottom) {
                ProjectFilterPicker(model: model, close: { presented = false }).themed(theme)
            }
    }
}

struct ProjectFilterSummary: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    var body: some View {
        if let id = model.sidebarProjectFilter {
            let name = model.chats?.projects?.first { $0.id == id }?.name ?? "Selected project"
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Image(systemName: "folder").font(.system(size: 10))
                    Text(name).lineLimit(1).help(name)
                    Spacer(minLength: 0)
                    Button { model.settings.projectFilter = nil } label: {
                        Image(systemName: "xmark").frame(width: 20, height: 20)
                    }.buttonStyle(.plain).accessibilityLabel("Show all projects")
                }.font(.system(size: 11, weight: .medium))
                if !model.searchQuery.isEmpty {
                    Text("Search covers all projects.").font(.system(size: 10.5))
                } else if model.chats?.currentProjectId != id {
                    Text("Current chat is outside this filter.").font(.system(size: 10.5))
                }
            }.foregroundStyle(theme.text2.color).padding(.horizontal, 8).padding(.bottom, 6)
        }
    }
}

struct ProjectFilterPicker: View {
    let model: IslandModel
    var initialQuery = ""
    var close: () -> Void
    @State private var query = ""
    @State private var cursor = 0
    @FocusState private var focused: Bool
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    private var choices: [ProjectFilterChoice] {
        ProjectSidebarScope.choices(projects: model.chats?.projects ?? [], query: snapshot ? initialQuery : query)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if snapshot {
                Text(initialQuery.isEmpty ? "Search projects…" : initialQuery)
                    .font(.system(size: 13)).foregroundStyle(theme.text2.color).padding(12)
            } else {
                TextField("Search projects…", text: $query).textFieldStyle(.plain).font(.system(size: 13))
                    .focused($focused).padding(12).accessibilityLabel("Search projects")
                    .onKeyPress(.downArrow) { move(1); return .handled }
                    .onKeyPress(.upArrow) { move(-1); return .handled }
                    .onSubmit { if choices.indices.contains(cursor) { choose(choices[cursor]) } }
                    .onExitCommand(perform: close)
            }
            Rectangle().fill(theme.separator.color).frame(height: 1)
            ScrollViewReader { proxy in
                Scrollable {
                    VStack(spacing: 2) {
                        if choices.isEmpty {
                            Text("No matching projects").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                        }
                        ForEach(Array(choices.enumerated()), id: \.element.id) { index, choice in
                            row(choice, cursor: index == cursor).id(choice.id)
                        }
                    }.padding(6)
                }
                .onChange(of: cursor) { if choices.indices.contains(cursor) { proxy.scrollTo(choices[cursor].id) } }
            }.frame(maxHeight: .infinity)
            Rectangle().fill(theme.separator.color).frame(height: 1)
            Text("Filters lists only · Search covers all content")
                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color).padding(10)
        }
        .frame(width: 340, height: 360).background(theme.surfaceSolid.color)
        .onAppear { query = initialQuery; if !snapshot { focused = true } }
        .onChange(of: choices.map(\.id)) { cursor = 0 }
    }
    private func row(_ choice: ProjectFilterChoice, cursor: Bool) -> some View {
        let selected = model.settings.projectFilter == choice.project?.id
        return HStack(spacing: 0) {
            Button { choose(choice) } label: {
                HStack(spacing: 8) {
                    Image(systemName: choice.project?.missing == true ? "exclamationmark.triangle" : "folder")
                        .frame(width: 18).font(.system(size: 12))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(choice.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                        if let project = choice.project, project.archived || project.missing {
                            Text([project.archived ? "Archived" : nil, project.missing ? "Folder unavailable" : nil].compactMap { $0 }.joined(separator: " · "))
                                .font(.system(size: 10.5)).foregroundStyle(theme.text3.color)
                        }
                    }
                    Spacer(minLength: 4)
                    if selected { Image(systemName: "checkmark").font(.system(size: 10, weight: .semibold)) }
                }.foregroundStyle(theme.text.color).padding(9).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Filter: " + choice.title)
                .accessibilityAddTraits(selected ? .isSelected : [])
            if let project = choice.project {
                Button { close(); model.openProjectSettings(project.id) } label: {
                    Image(systemName: "gearshape").font(.system(size: 12)).foregroundStyle(theme.text2.color)
                        .frame(width: 30, height: 34).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel("Settings for " + project.name).help("Project settings")
            }
        }.background(cursor ? theme.fill2.color : .clear, in: RoundedRectangle(cornerRadius: 6))
    }
    private func choose(_ choice: ProjectFilterChoice) {
        let id = choice.project?.id
        guard id == nil || model.chats?.projects?.contains(where: { $0.id == id }) == true else { return }
        model.settings.projectFilter = id
        close()
    }
    private func move(_ delta: Int) { cursor = max(0, min(max(0, choices.count - 1), cursor + delta)) }
}
