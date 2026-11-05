import SwiftUI
import ArkIslandCore

/// Automations (2026-11-06, Keshab: "I like the word automation … merge into one, designed like workflows"): everything that runs by
/// itself or when you press Run, on one page, in the workflow card style. Workflows (2026-11-02, a trigger then steps, each an agent's
/// task; the runtime's workflows.ts), the routines that were the Scheduled page (one agent's task on a timer, drawn as a one-step
/// automation), and the web pages ARK watches. Filters: All, On a timer, When something happens, By hand.
struct WorkflowsPane: View {
    let model: IslandModel
    @State private var editing: Workflow?
    /// The workflow open on the canvas (2026-11-05); nil shows the list.
    @State private var opened: String?
    /// A routine's form: new or edit (the old Scheduled page's form, with Telegram and webhook options).
    @State private var routineForm: ScheduleForm?
    @State private var filter: AutomationFilter = .all
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let list = model.workflows?.workflows ?? []
        Group {
            if let id = opened, let flow = list.first(where: { $0.id == id }) {
                WorkflowCanvas(model: model, flow: flow, close: { opened = nil }, edit: { editing = $0 })
            } else {
                listView(list)
            }
        }
        .onAppear { model.send(.workflowsList); model.send(.watchesGet) }
        .sheet(item: $editing) { flow in WorkflowEditor(model: model, draft: flow).themed(theme) }
    }

    private func listView(_ list: [Workflow]) -> some View {
        let routines = model.helpers.list.map(ScheduledPage.init(list:))?.entries ?? []
        let flows = list.filter { filter.shows(trigger: $0.trigger.kind) }
        let shownRoutines = filter.showsRoutines ? routines : []
        let shownWatches = filter.showsWatches ? model.watches : []
        return Scrollable {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Automations").appFont(theme.pageTitleFont()).foregroundStyle(theme.text.color)
                        Text("What runs by itself: a trigger, then steps your agents run in order. Each step gets the report of the one before.")
                            .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                    }
                    Spacer()
                    newMenu
                }
                filterBar(counts: (list.count + routines.count + model.watches.count,
                                   list.filter { $0.trigger.kind == "schedule" }.count + routines.count,
                                   list.filter { $0.trigger.kind == "event" }.count + model.watches.count,
                                   list.filter { $0.trigger.kind == "manual" }.count))
                if let problem = model.workflows?.problem { ProblemLine(text: problem) }
                if let problem = model.helpers.problem { ProblemLine(text: problem) }
                if routineForm != nil { ScheduleFormCard(model: model, form: $routineForm) }
                if model.workflows == nil || model.helpers.list == nil {
                    LoadingStateView(text: "Loading automations…", retry: { model.send(.workflowsList); model.send(.helpersList) })
                }
                else if flows.isEmpty && shownRoutines.isEmpty && shownWatches.isEmpty {
                    EmptyStateView(title: filter == .all ? "No automations yet" : "Nothing here",
                                   detail: "Make one: for example, every morning Sid collects the news, then Quill writes a short summary.")
                }
                ForEach(flows) { flow in card(flow) }
                ForEach(shownRoutines) { entry in routineCard(entry) }
                if !shownWatches.isEmpty {
                    Text("Watched pages").appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text2.color).padding(.top, 8)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(shownWatches) { watch in WatchCard(model: model, watch: watch) }
                }
            }
            .padding(24)
        }
    }

    /// One "New automation" button: a workflow (any trigger, up to eight steps), or one task repeated on a timer (with a Telegram
    /// notice or a webhook, as the old Scheduled page made).
    @ViewBuilder private var newMenu: some View {
        let label = Label("New automation", systemImage: "plus").appFont(.system(size: 12, weight: .semibold))
        // A snapshot cannot draw a Menu: the gallery shows the button alone.
        if snapshot { Button {} label: { label }.buttonStyle(.borderedProminent).tint(theme.accent.color).foregroundStyle(theme.onAccent.color) } else {
        Menu {
            Button { editing = Workflow(name: "", steps: [Workflow.Step(helper: agents.first?.id ?? "", task: "")]) } label: {
                Label("Workflow: steps your agents run in order", systemImage: "point.3.connected.trianglepath.dotted")
            }
            Button {
                if let first = model.helpers.list?.helpers.first(where: \.takesTasks) {
                    let start = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
                    routineForm = ScheduleForm(id: nil, draft: RoutineDraft(helper: first.id, startAt: start))
                }
            } label: { Label("Repeat one task on a timer", systemImage: "repeat") }
            .disabled(model.helpers.list?.helpers.contains(where: \.takesTasks) != true)
        } label: { label }
        .menuStyle(.borderedButton).fixedSize().disabled(agents.isEmpty)
        .accessibilityLabel("New automation")
        }
    }

    private func filterBar(counts: (all: Int, timer: Int, event: Int, manual: Int)) -> some View {
        HStack(spacing: 6) {
            chip(.all, counts.all)
            chip(.timer, counts.timer)
            chip(.event, counts.event)
            chip(.manual, counts.manual)
        }
    }

    private func chip(_ value: AutomationFilter, _ count: Int) -> some View {
        let on = filter == value
        return Button { filter = value } label: {
            HStack(spacing: 6) {
                Text(value.title).appFont(.system(size: 12, weight: on ? .semibold : .medium))
                Text("\(count)").appFont(.system(size: 11)).monospacedDigit().foregroundStyle(theme.text3.color)
            }
            .foregroundStyle(on ? theme.text.color : theme.text2.color)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Capsule().fill(on ? theme.fill3.color : theme.fill1.color))
            .overlay(Capsule().strokeBorder(theme.separator.color, lineWidth: 0.6))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var agents: [Helper] { (model.helpers.list?.helpers ?? []).filter { $0.role != "improver" } }

    private func card(_ flow: Workflow) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(flow.name).appFont(.system(size: 15, weight: .semibold)).foregroundStyle(theme.text.color)
                Text(flow.enabled ? "Live" : "Draft").appFont(.system(size: 11, weight: .medium))
                    .foregroundStyle(flow.enabled ? theme.success.color : theme.text3.color)
                    .padding(.horizontal, 8).padding(.vertical, 2).background(Capsule().fill(theme.fill2.color))
                Spacer()
                if let at = flow.lastRunAt.flatMap({ ISO8601DateFormatter.withFraction.date(from: $0) }) {
                    Text("Last run " + at.formatted(.relative(presentation: .named))).appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                }
            }
            // The flow, as the reference's canvas draws it: the trigger node, then each step.
            FlowLayout(spacing: 6) {
                node(symbol: "bolt", title: flow.triggerTitle, accent: true)
                ForEach(Array(flow.steps.enumerated()), id: \.offset) { index, step in
                    Glyph(systemName: "arrow.right").appFont(.system(size: 10)).foregroundStyle(theme.text3.color).padding(.vertical, 8)
                    node(symbol: "\(index + 1).circle", title: "\(name(step.helper)): \(step.task)", accent: false)
                }
            }
            .contentShape(Rectangle()).onTapGesture { opened = flow.id }
            HStack(spacing: 8) {
                QuietButton(title: "Open canvas", symbol: "square.grid.3x3") { opened = flow.id }
                QuietButton(title: "Test run", symbol: "play") { model.send(.workflowRun(id: flow.id)) }
                QuietButton(title: flow.enabled ? "Unpublish" : "Publish", symbol: flow.enabled ? "pause" : "paperplane") {
                    var changed = flow; changed.enabled.toggle(); model.send(.workflowSave(changed))
                }
                QuietButton(title: "Edit", symbol: "pencil") { editing = flow }
                Spacer()
                Button("Delete", role: .destructive) { model.send(.workflowDelete(id: flow.id)) }.buttonStyle(.plain)
                    .appFont(.system(size: 12)).foregroundStyle(theme.problem.color)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.border.color, lineWidth: 1))
    }

    /// A routine (one agent's task on a timer) in the same card style: its timer as the trigger node, then its one step.
    private func routineCard(_ entry: ScheduledPage.Entry) -> some View {
        let routine: HelperRoutine? = {
            if case .routine(let id) = entry.kind { return model.helpers.list?.helpers.first { $0.id == entry.helperId }?.routines.first { $0.id == id } }
            return nil
        }()
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(entry.title).appFont(.system(size: 15, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                Text(entry.paused ? "Paused" : "Live").appFont(.system(size: 11, weight: .medium))
                    .foregroundStyle(entry.paused ? theme.attention.color : theme.success.color)
                    .padding(.horizontal, 8).padding(.vertical, 2).background(Capsule().fill(theme.fill2.color))
                Spacer()
                Text(ScheduledPage.nextText(entry)).appFont(.system(size: 11)).monospacedDigit().foregroundStyle(theme.text3.color)
            }
            FlowLayout(spacing: 6) {
                node(symbol: "clock", title: entry.schedule, accent: true)
                Glyph(systemName: "arrow.right").appFont(.system(size: 10)).foregroundStyle(theme.text3.color).padding(.vertical, 8)
                node(symbol: "1.circle", title: "\(entry.helperName): \(entry.title)", accent: false)
            }
            HStack(spacing: 8) {
                QuietButton(title: entry.paused ? "Resume" : "Pause", symbol: entry.paused ? "play" : "pause") {
                    if case .routine(let id) = entry.kind { model.sendHelpers(model.helpers.pauseRoutine(id, paused: !entry.paused)) }
                }
                if let routine {
                    QuietButton(title: "Edit", symbol: "pencil") { routineForm = ScheduleForm(id: routine.id, draft: RoutineDraft(routine: routine, helper: entry.helperId)) }
                }
                Text(ScheduledPage.lastText(entry)).appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                Spacer()
                Button("Delete", role: .destructive) {
                    if case .routine(let id) = entry.kind { model.sendHelpers(model.helpers.deleteAnyRoutine(id)) }
                }.buttonStyle(.plain).appFont(.system(size: 12)).foregroundStyle(theme.problem.color)
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).fill(theme.fill1.color))
        .overlay(RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous).strokeBorder(theme.border.color, lineWidth: 1))
    }

    private func node(symbol: String, title: String, accent: Bool) -> some View {
        Label(title, systemImage: symbol).appFont(.system(size: 12)).lineLimit(1).frame(maxWidth: 260, alignment: .leading)
            .foregroundStyle(accent ? theme.onAccent.color : theme.text.color)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl).fill(accent ? theme.accent.color : theme.fill2.color))
    }

    private func name(_ helper: String) -> String { agents.first { $0.id == helper }?.name ?? helper }
}

/// The Automations filters: what starts each one.
enum AutomationFilter: CaseIterable {
    case all, timer, event, manual

    var title: String {
        switch self {
        case .all: "All"
        case .timer: "On a timer"
        case .event: "When something happens"
        case .manual: "By hand"
        }
    }

    func shows(trigger kind: String) -> Bool {
        switch self {
        case .all: true
        case .timer: kind == "schedule"
        case .event: kind == "event"
        case .manual: kind == "manual"
        }
    }
    var showsRoutines: Bool { self == .all || self == .timer }
    /// A watched page is a "when something happens" automation: ARK acts when the page changes.
    var showsWatches: Bool { self == .all || self == .event }
}

extension ISO8601DateFormatter {
    /// The runtime's dates: `2026-11-02T05:00:00.000Z`. Read on the main thread only.
    @MainActor static let withFraction: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
}

/// New or Edit: the name, the trigger and up to eight steps. Save keeps a draft as a draft; publishing is on the card.
struct WorkflowEditor: View {
    let model: IslandModel
    @State var draft: Workflow
    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme

    private enum TriggerChoice: String, CaseIterable { case manual = "By hand", daily = "Every day at", hours = "Every few hours", failed = "When a Board task fails", done = "When a Board task finishes" }

    var body: some View {
        let agents = (model.helpers.list?.helpers ?? []).filter { $0.role != "improver" }
        VStack(alignment: .leading, spacing: 14) {
            Text(draft.id.isEmpty ? "New workflow" : "Edit workflow").appFont(.system(size: 18, weight: .semibold))
            TextField("Name, such as Morning digest", text: $draft.name).textFieldStyle(.roundedBorder)
            Picker("Trigger", selection: Binding(get: { choice }, set: { set($0) })) {
                ForEach(TriggerChoice.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            if choice == .daily {
                Stepper("At \(String(format: "%d:%02d", (draft.trigger.schedule?.minute ?? 480) / 60, (draft.trigger.schedule?.minute ?? 480) % 60))",
                        value: Binding(get: { draft.trigger.schedule?.minute ?? 480 }, set: { draft.trigger.schedule?.minute = $0 }), in: 0...1425, step: 15)
            }
            if choice == .hours {
                Stepper("Every \(draft.trigger.schedule?.every ?? 1) hours", value: Binding(get: { draft.trigger.schedule?.every ?? 1 }, set: { draft.trigger.schedule?.every = $0 }), in: 1...168)
            }
            Text("Steps").appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
            ForEach(draft.steps.indices, id: \.self) { i in
                HStack(alignment: .top, spacing: 8) {
                    Text("\(i + 1)").appFont(.system(size: 12, design: .monospaced)).foregroundStyle(theme.text3.color).padding(.top, 6)
                    Picker("", selection: $draft.steps[i].helper) { ForEach(agents) { Text($0.name).tag($0.id) } }.labelsHidden().frame(width: 140)
                    TextField("What this agent does", text: $draft.steps[i].task, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...4)
                    Button { removeStep(i) } label: { Glyph(systemName: "minus.circle") }.buttonStyle(.plain).disabled(draft.steps.count == 1)
                        .accessibilityLabel("Remove step \(i + 1)")
                }
            }
            Button { draft.steps.append(Workflow.Step(helper: agents.first?.id ?? "", task: "")) } label: { Label("Add step", systemImage: "plus") }
                .disabled(draft.steps.count >= Workflow.maxSteps)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Save") { model.send(.workflowSave(draft)); dismiss() }.keyboardShortcut(.defaultAction)
                    .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty || draft.steps.contains { $0.task.trimmingCharacters(in: .whitespaces).isEmpty })
            }
        }
        .padding(24).frame(width: 560).floatingSurface()
    }

    /// Removes a step; the canvas places of the steps after it move up one index with them.
    private func removeStep(_ i: Int) {
        draft.steps.remove(at: i)
        guard let layout = draft.layout else { return }
        draft.layout = Dictionary(uniqueKeysWithValues: layout.compactMap { key, point -> (String, Workflow.Point)? in
            guard let n = Int(key) else { return (key, point) }
            return n == i ? nil : (n > i ? String(n - 1) : key, point)
        })
    }

    private var choice: TriggerChoice {
        switch (draft.trigger.kind, draft.trigger.schedule?.kind, draft.trigger.event) {
        case ("schedule", "daily", _): .daily
        case ("schedule", _, _): .hours
        case ("event", _, "task.failed"): .failed
        case ("event", _, _): .done
        default: .manual
        }
    }

    private func set(_ c: TriggerChoice) {
        switch c {
        case .manual: draft.trigger = Workflow.Trigger(kind: "manual")
        case .daily: draft.trigger = Workflow.Trigger(kind: "schedule", schedule: Workflow.Schedule(kind: "daily", minute: 480))
        case .hours: draft.trigger = Workflow.Trigger(kind: "schedule", schedule: Workflow.Schedule(kind: "hours", every: 4))
        case .failed: draft.trigger = Workflow.Trigger(kind: "event", event: "task.failed")
        case .done: draft.trigger = Workflow.Trigger(kind: "event", event: "task.done")
        }
    }
}
