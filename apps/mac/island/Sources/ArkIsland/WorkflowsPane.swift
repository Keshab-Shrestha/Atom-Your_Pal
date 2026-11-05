import SwiftUI
import ArkIslandCore

/// Workflows (2026-11-02, Keshab's reference's Workflows page): each workflow as a card with its flow drawn as nodes, trigger then
/// steps; Draft or Live; Test run, Publish, Edit and Delete. A run makes one plan of the steps in order (the runtime's workflows.ts).
struct WorkflowsPane: View {
    let model: IslandModel
    @State private var editing: Workflow?
    /// The workflow open on the canvas (2026-11-05); nil shows the list.
    @State private var opened: String?
    @Environment(\.theme) private var theme

    var body: some View {
        let list = model.workflows?.workflows ?? []
        Group {
            if let id = opened, let flow = list.first(where: { $0.id == id }) {
                WorkflowCanvas(model: model, flow: flow, close: { opened = nil }, edit: { editing = $0 })
            } else {
                listView(list)
            }
        }
        .onAppear { model.send(.workflowsList) }
        .sheet(item: $editing) { flow in WorkflowEditor(model: model, draft: flow).themed(theme) }
    }

    private func listView(_ list: [Workflow]) -> some View {
        Scrollable {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Workflows").appFont(theme.pageTitleFont()).foregroundStyle(theme.text.color)
                        Text("A trigger, then steps your agents run in order. Each step gets the report of the one before.")
                            .appFont(.system(size: 12)).foregroundStyle(theme.text2.color)
                    }
                    Spacer()
                    Button { editing = Workflow(name: "", steps: [Workflow.Step(helper: agents.first?.id ?? "", task: "")]) } label: {
                        Label("New workflow", systemImage: "plus").appFont(.system(size: 12, weight: .semibold))
                    }
                    .buttonStyle(.borderedProminent).tint(theme.accent.color).foregroundStyle(theme.onAccent.color).disabled(agents.isEmpty)
                }
                if let problem = model.workflows?.problem { ProblemLine(text: problem) }
                if model.workflows == nil { LoadingStateView(text: "Loading workflows…", retry: { model.send(.workflowsList) }) }
                else if list.isEmpty {
                    EmptyStateView(title: "No workflows yet", detail: "Make one: for example, every morning Sid collects the news, then Quill writes a short summary.")
                }
                ForEach(list) { flow in card(flow) }
            }
            .padding(24)
        }
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

    private func node(symbol: String, title: String, accent: Bool) -> some View {
        Label(title, systemImage: symbol).appFont(.system(size: 12)).lineLimit(1).frame(maxWidth: 260, alignment: .leading)
            .foregroundStyle(accent ? theme.onAccent.color : theme.text.color)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(RoundedRectangle(cornerRadius: theme.radiusControl).fill(accent ? theme.accent.color : theme.fill2.color))
    }

    private func name(_ helper: String) -> String { agents.first { $0.id == helper }?.name ?? helper }
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
