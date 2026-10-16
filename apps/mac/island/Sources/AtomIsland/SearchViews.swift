import SwiftUI
import AtomIslandCore

// ADR-098 item 6: the sidebar's one search (chats, tasks, reports), a task's labels, and the Board's label filter.
// `State` and `FocusState` without the macros: Command Line Tools ship no SwiftUI macro plugin.

/// The search field at the top of the sidebar. ⌘F focuses it; Esc or the clear button empties it.
struct SidebarSearchField: View {
    let model: IslandModel
    private let focus = FocusState<Bool>()
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel) { self.model = model }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
            if snapshot {
                Text("Search").font(.system(size: 12.5)).foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField("Search", text: Binding(get: { model.searchText }, set: { model.searchText = String($0.prefix(TaskLabels.maxQuery)) }))
                    .textFieldStyle(.plain).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                    .focused(focus.projectedValue)
                    .onSubmit { model.runSearch() }
                    .onExitCommand { model.clearSearch() }
                    .accessibilityLabel("Search chats, tasks and reports")
            }
            if !model.searchText.isEmpty {
                Button { model.clearSearch() } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 11)).foregroundStyle(theme.text3.color)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 28)
        .background(RoundedRectangle(cornerRadius: theme.radiusControl + 2, style: .continuous).fill(theme.fill2.color))
        .help("Search chats, tasks and reports (⌘F)")
        // A short pause after the last key, then one search.
        .task(id: model.searchText) {
            try? await Task.sleep(for: .milliseconds(250))
            if !Task.isCancelled { model.runSearch() }
        }
        .onChange(of: model.searchFocusTick) { focus.wrappedValue = true }
        .onAppear {
            guard model.searchFocusPending else { return }
            model.searchFocusPending = false
            DispatchQueue.main.async { focus.wrappedValue = true }
        }
    }
}

/// The results in place of the sidebar's pages while there are words: Chats, Tasks, Reports, each with a snippet and a date.
struct SidebarSearchResults: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        if let results = model.searchResults {
            if results.isEmpty {
                Text("Nothing found.").font(.system(size: 11.5)).foregroundStyle(theme.text3.color).padding(.horizontal, 10).padding(.vertical, 4)
            }
            group("Chats", results.chats) { hit in
                model.navigate {
                    if hit.id != model.chats?.current { model.send(.chatOpen(id: hit.id)) }
                    model.windowPage = .chat
                }
            }
            group("Tasks", results.tasks, open: openTask)
            group("Reports", results.reports, open: openTask)
        } else {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Searching…").font(.system(size: 11.5)).foregroundStyle(theme.text3.color)
            }
            .padding(.horizontal, 10).padding(.vertical, 4)
        }
    }

    /// A task or report opens its task's thread; one older than the Board shows cannot open.
    private func openTask(_ hit: SearchHit) {
        guard let id = hit.taskId, model.helpers.list?.item(id) != nil else { return }
        model.navigate {
            model.windowPage = .agents
            model.sendHelpers(model.helpers.openThread(id))
        }
    }

    @ViewBuilder
    private func group(_ title: String, _ hits: [SearchHit], open: @escaping (SearchHit) -> Void) -> some View {
        if !hits.isEmpty {
            Text(title).font(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color).padding(.horizontal, 10).padding(.top, 8)
            ForEach(hits) { hit in
                let openable = title == "Chats" || hit.taskId.flatMap { model.helpers.list?.item($0) } != nil
                Button { open(hit) } label: { row(hit) }
                    .buttonStyle(.plain)
                    .opacity(openable ? 1 : 0.5)
                    .help(openable ? "" : "This task is older than the Board shows.")
                    .accessibilityLabel("\(hit.title). \(hit.snippet)")
            }
        }
    }

    private func row(_ hit: SearchHit) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(hit.title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
            if !hit.snippet.isEmpty, hit.snippet != hit.title {
                Text(hit.snippet).font(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(2)
            }
            if let at = hit.at {
                Text(at, format: .relative(presentation: .named)).font(.system(size: 10.5)).foregroundStyle(theme.text3.color).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10).padding(.vertical, 5)
        .contentShape(Rectangle())
    }
}

/// A task's labels as small chips (× removes one) and an "Add label" field; Return or Add saves.
struct TaskLabelsSection: View {
    let model: IslandModel
    let job: HelperJob
    private let draft = State(initialValue: "")
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    init(model: IslandModel, job: HelperJob) {
        self.model = model
        self.job = job
    }

    var body: some View {
        let typed = !draft.wrappedValue.trimmingCharacters(in: .whitespaces).isEmpty
        let full = job.labels.count >= TaskLabels.maxLabels
        VStack(alignment: .leading, spacing: 8) {
            Text("Labels").font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text3.color)
            if !job.labels.isEmpty {
                HStack(spacing: 6) {
                    ForEach(job.labels, id: \.self) { label in
                        HStack(spacing: 4) {
                            Text(label).font(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text.color)
                            Button { model.sendHelpers(model.helpers.removeLabel(label)) } label: {
                                Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).foregroundStyle(theme.text3.color)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove label \(label)")
                        }
                        .padding(.horizontal, 9).frame(height: 22)
                        .background(Capsule().fill(theme.fill2.color))
                    }
                }
            }
            if !full {
                HStack(spacing: 8) {
                    if snapshot {
                        Text("Add label").font(.system(size: 12.5)).foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        TextField("Add label", text: Binding(get: { draft.wrappedValue }, set: { draft.wrappedValue = String($0.prefix(TaskLabels.maxLength)) }))
                            .textFieldStyle(.plain).font(.system(size: 12.5)).foregroundStyle(theme.text.color)
                            .onSubmit(add)
                            .accessibilityLabel("New label")
                    }
                    SaveButton(title: "Add", enabled: typed, saved: model.savedField == "label" && model.helpers.problem == nil, label: "Add label", action: add)
                }
                .padding(.leading, 14).padding(.trailing, 6)
                .frame(height: 38)
                .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.isFlat ? theme.border.color : theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
            }
        }
        .tracksEdits(model, "label", typed)
    }

    private func add() {
        guard let command = model.helpers.addLabel(draft.wrappedValue) else { return }
        model.send(command)
        draft.wrappedValue = ""
        model.showSaved("label")
    }
}

/// The Board's label filter: the labels in use; choosing one shows only its tasks (as columns); "All" clears it.
struct BoardLabelMenu: View {
    let model: IslandModel

    var body: some View {
        let labels = TaskLabels.inUse(model.helpers.list?.helpers.flatMap(\.jobs) ?? [])
        if !labels.isEmpty || model.boardLabel != nil {
            Menu {
                Button("All") { model.boardLabel = nil }
                Divider()
                ForEach(labels, id: \.self) { label in
                    Button(label) {
                        model.boardLabel = label
                        model.boardView = .columns // the floor shows people, not tasks: the columns show the filter
                    }
                }
            } label: {
                PillMenuLabel(label: "Label", value: model.boardLabel ?? "All", dimmed: model.boardLabel == nil, identifier: false)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("Filter the Board by label")
        }
    }
}
