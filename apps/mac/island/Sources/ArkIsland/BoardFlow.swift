import SwiftUI
import ArkIslandCore

/// ADR-256: the Board's Flow. One view replaces the Needs you and Tasks tabs on a wide window: four lanes side by side, read left to
/// right as the work moves. Needs you (decisions and failed tasks, answered in place), Running, To do, Done. A card opens the task's
/// inspector over the right of the lanes; a second click or ✕ closes it. Each lane scrolls by itself, so the page never does.
struct BoardFlow: View {
    let model: IslandModel
    let board: [(column: BoardColumn, items: [BoardItem])]
    @State private var inspected: Int?
    /// The inspector's width; Keshab drags its left edge (hand check 2026-11-05: 360 pt was too small to review a task).
    @State private var inspectorWidth: CGFloat = 560
    @State private var dragStartWidth: CGFloat?
    @State private var cursorPushed = false
    @Environment(\.theme) private var theme

    static let laneSpacing: CGFloat = 12
    static let inspectorMin: CGFloat = 420

    var body: some View {
        let attention = BoardAttention(list: model.helpers.list, approvalPending: model.approval.pending != nil)
        let chosen = inspected.flatMap { id in board.flatMap(\.items).first { $0.id == id } }
        GeometryReader { proxy in
        let maxWidth = max(Self.inspectorMin, proxy.size.width - 120)
        HStack(alignment: .top, spacing: Self.laneSpacing) {
            FlowLane(title: "Needs you", symbol: "tray", tint: theme.attention.color, count: attention.total) {
                NeedsYouPane(model: model, embedded: true, lane: true)
            }
            ForEach([BoardColumn.running, .toDo, .done], id: \.self) { column in
                let items = board.first { $0.column == column }?.items ?? []
                FlowLane(title: column.title, symbol: Self.symbol(column), tint: tint(column), count: items.count) {
                    if items.isEmpty {
                        Text(Self.empty(column)).appFont(.system(size: 12)).foregroundStyle(theme.text3.color)
                            .padding(.horizontal, 12).padding(.top, 4).frame(maxWidth: .infinity, alignment: .leading)
                        Spacer(minLength: 0)
                    } else {
                        // ADR-273: a job an agent started sits under that agent's job when both are in this lane.
                        let workers = JobTree.workerCounts(model.helpers.list?.everyTask.map(\.job) ?? [])
                        Scrollable {
                            VStack(spacing: 8) {
                                ForEach(JobTree.ordered(items, id: \.id, parent: \.job.parentId), id: \.item.id) { entry in
                                    let item = entry.item
                                    FlowCard(model: model, item: item, selected: chosen?.id == item.id, workers: workers[item.id] ?? 0, nested: entry.depth > 0) {
                                        inspected = inspected == item.id ? nil : item.id
                                    }
                                    .padding(.leading, CGFloat(entry.depth) * 16)
                                }
                            }
                            .padding(.horizontal, 8).padding(.bottom, 8)
                        }
                    }
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            if let chosen {
                ZStack(alignment: .topTrailing) {
                    Scrollable { TaskInspector(model: model, item: chosen).padding(4) }
                    Button { inspected = nil } label: {
                        Glyph(systemName: "xmark").appFont(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text2.color)
                            .frame(width: 28, height: 28).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).help("Close the task").accessibilityLabel("Close the task")
                    .padding(8)
                }
                .frame(width: min(max(inspectorWidth, Self.inspectorMin), maxWidth))
                .frame(maxHeight: .infinity, alignment: .top)
                .floatingSurface(RoundedRectangle(cornerRadius: theme.radiusCard + 6, style: .continuous))
                .overlay(alignment: .leading) { resizeHandle(maxWidth: maxWidth) }
                .overlay(alignment: .topTrailing) {
                    // The whole task, as its own page, for a long review.
                    Button { model.navigate { model.sendHelpers(model.helpers.openThread(chosen.id)) } } label: {
                        Glyph(systemName: "arrow.up.left.and.arrow.down.right").appFont(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text2.color)
                            .frame(width: 28, height: 28).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).help("Open the task as a full page").accessibilityLabel("Open the task as a full page")
                    .padding(.top, 8).padding(.trailing, 40)
                }
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: inspected)
        .onExitCommand { inspected = nil }
        }
    }

    private func setResizeCursor(_ on: Bool) {
        guard on != cursorPushed else { return }
        if on { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
        cursorPushed = on
    }

    /// A thin grip on the inspector's left edge: drag left to widen it.
    private func resizeHandle(maxWidth: CGFloat) -> some View {
        Rectangle().fill(Color.clear).frame(width: 8).frame(maxHeight: .infinity).contentShape(Rectangle())
            .onHover { inside in setResizeCursor(inside) }
            .onDisappear { setResizeCursor(false) }
            // Global points: the handle moves with the width, so its own space would feed the drag back into itself.
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { value in
                    let start = dragStartWidth ?? inspectorWidth
                    dragStartWidth = start
                    inspectorWidth = min(max(start - value.translation.width, Self.inspectorMin), maxWidth)
                }
                .onEnded { _ in dragStartWidth = nil })
            .accessibilityHidden(true)
    }

    private func tint(_ column: BoardColumn) -> Color {
        switch column {
        case .needsYou: theme.attention.color
        case .running: theme.live.color
        case .toDo: theme.text3.color
        case .done: theme.success.color
        }
    }

    static func symbol(_ column: BoardColumn) -> String {
        switch column {
        case .needsYou: "tray"
        case .running: "bolt.horizontal"
        case .toDo: "circle.dashed"
        case .done: "checkmark.circle"
        }
    }

    /// What an empty lane says: the state, and how a task gets there.
    static func empty(_ column: BoardColumn) -> String {
        switch column {
        case .needsYou: "Nothing waits for you."
        case .running: "No agent is working. Give one a task to start it."
        case .toDo: "Nothing queued. Tasks that wait for another task or a free agent show here."
        case .done: "Finished tasks show here, with what they changed."
        }
    }
}

/// One lane: a frosted column with its name, a dot in its colour and a count, and its own scrolling content.
private struct FlowLane<Content: View>: View {
    let title: String
    let symbol: String
    let tint: Color
    let count: Int
    @ViewBuilder let content: () -> Content
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard + 6, style: .continuous)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Glyph(systemName: symbol).appFont(.system(size: 12, weight: .semibold)).foregroundStyle(tint)
                Text(title).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
                Text("\(count)").appFont(.system(size: 11, weight: .medium)).monospacedDigit().foregroundStyle(theme.text3.color)
                    .padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(theme.fill2.color))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.top, 12)
            .accessibilityElement(children: .combine).accessibilityLabel("\(title), \(count)")
            content()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
        .clipShape(shape)
    }
}

/// A task in a lane: the Board's card on its own frosted tile. Shaded while its inspector is open.
private struct FlowCard: View {
    let model: IslandModel
    let item: BoardItem
    let selected: Bool
    var workers = 0
    var nested = false
    let choose: () -> Void
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard + 2, style: .continuous)
        Button(action: choose) {
            VStack(alignment: .leading, spacing: 0) {
                // The lane indents the whole card; the card's own clock line gives the time.
                BoardCard(model: model, item: item, workers: workers, showsAge: false, showsParent: !nested)
                footer.padding(.horizontal, 16).padding(.bottom, 10).padding(.top, -4)
            }
                .background(shape.fill(selected ? theme.fill3.color : theme.fill2.color))
                .overlay(shape.strokeBorder(selected ? theme.accent.color.opacity(0.6) : theme.separator.color, lineWidth: selected ? 1.2 : 0.6))
                .clipShape(shape)
        }
        .buttonStyle(.pressable)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// The card's state and time on one quiet line (after affectUI's Agent Inbox look): a spinner and a live clock while it runs,
    /// "Waiting for you" when it needs Keshab, a green dot and how long it took once done, red once failed.
    @ViewBuilder
    private var footer: some View {
        let job = item.job
        HStack(spacing: 6) {
            switch job.state {
            case .running:
                RaySpinner(size: 10, color: theme.live.color)
                if snapshot { clock(job.clockText()) } else {
                    TimelineView(.periodic(from: .now, by: 1)) { context in clock(job.clockText(now: context.date)) }
                }
            case .done:
                Circle().fill(theme.success.color).frame(width: 6, height: 6)
                clock(job.clockText().map { "Took \($0)" })
            case .failed:
                Glyph(systemName: "exclamationmark.circle.fill").appFont(.system(size: 10)).foregroundStyle(theme.problem.color)
                Text("Failed").foregroundStyle(theme.problem.color)
            case .stopped:
                Glyph(systemName: "stop.circle").appFont(.system(size: 10)).foregroundStyle(theme.text3.color)
                Text("Stopped").foregroundStyle(theme.text2.color)
                clock(job.clockText().map { "after \($0)" })
            case .queued:
                if job.awaitsApproval || job.held != nil {
                    Glyph(systemName: "exclamationmark.triangle.fill").appFont(.system(size: 10)).foregroundStyle(theme.attention.color)
                    Text("Waiting for you").foregroundStyle(theme.text2.color)
                    clock(job.clockText().map { "· \($0)" })
                } else {
                    Circle().strokeBorder(theme.text3.color, lineWidth: 1).frame(width: 7, height: 7)
                    Text("Queued").foregroundStyle(theme.text3.color)
                }
            }
            Spacer(minLength: 0)
        }
        .appFont(.system(size: 11)).monospacedDigit()
        .help("Counted from when the task was given.")
    }

    private func clock(_ text: String?) -> some View {
        Text(text ?? "").foregroundStyle(theme.text3.color)
    }
}

/// ADR-256: the team as one row of compact pills: an avatar, a name and a live dot. Working agents first. A pill opens the agent.
struct TeamStrip: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let everyone = model.helpers.list?.helpers ?? []
        let chips = model.helpers.list.map { TeamRoster.chips(in: $0) } ?? []
        FlowLayout(spacing: 6) {
            ForEach(chips) { helper in
                Button { model.navigate { model.helpers.selectHelper(helper.id) } } label: {
                    HStack(spacing: 6) {
                        HelperBadge(helper: helper, size: 20)
                        Text(helper.name).appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1)
                        if TeamRoster.isWorking(helper) { Circle().fill(theme.live.color).frame(width: 6, height: 6) }
                    }
                    .padding(.leading, 4).padding(.trailing, 10).padding(.vertical, 4)
                    .background(Capsule().fill(theme.fill1.color))
                    .overlay(Capsule().strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.6))
                    .contentShape(Capsule())
                }
                .buttonStyle(.pressable)
                .help(TeamRoster.isWorking(helper) ? "\(helper.name): \(helper.activity)" : "\(helper.name), \(helper.roleTitle)")
                .accessibilityLabel(TeamRoster.isWorking(helper) ? "\(helper.name), working: \(helper.activity)" : "\(helper.name), \(helper.roleTitle)")
            }
            if chips.count < everyone.count {
                Button { model.navigate { model.showsAllAgents = true } } label: {
                    Label("All \(everyone.count)", systemImage: "person.2").appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text2.color)
                        .padding(.horizontal, 10).padding(.vertical, 6).contentShape(Capsule())
                }
                .buttonStyle(.plain).help("Every agent, by name or role")
            }
        }
    }
}

/// ADR-257: give the team a task from the Board. One line: the task, the agent it goes to (a free one is chosen first), and Send.
/// It sends what the agent panel sends (`jobAdd`); the task then shows in the To do or Running lane.
struct BoardComposer: View {
    let model: IslandModel
    @State private var text = ""
    @State private var chosen: String?
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let takers = TeamRoster.takers(model.helpers.list)
        let target = TeamRoster.taskTarget(takers, chosen: chosen)
        let empty = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        HStack(spacing: 10) {
            Glyph(systemName: "plus.bubble").appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text3.color)
            Group {
                if snapshot { Text("Give the team a task…").foregroundStyle(theme.text3.color).frame(maxWidth: .infinity, alignment: .leading) }
                else { TextField("Give the team a task…", text: $text).textFieldStyle(.plain).onSubmit { send(target) } }
            }
            .appFont(.system(size: 13))
            if let target {
                // A snapshot cannot draw a Menu: it shows the label alone.
                if snapshot { agentLabel(target) } else {
                    Menu {
                        ForEach(takers) { helper in
                            Button(TeamRoster.isWorking(helper) ? "\(helper.name) (working)" : "\(helper.name), \(helper.roleTitle)") { chosen = helper.id }
                        }
                    } label: { agentLabel(target) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .help("The agent this task goes to").accessibilityLabel("Agent: \(target.name)")
                }
            }
            Button { send(target) } label: {
                Glyph(systemName: "arrow.up").appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.onAccent.color)
                    .frame(width: 26, height: 26).background(Circle().fill(empty || target == nil ? theme.text3.color : theme.accent.color))
            }
            .buttonStyle(.plain).disabled(empty || target == nil)
            .accessibilityLabel(target.map { "Give the task to \($0.name)" } ?? "No agent can take a task")
        }
        .padding(.leading, 14).padding(.trailing, 8).padding(.vertical, 8)
        .floatingSurface(Capsule())
    }

    private func agentLabel(_ target: Helper) -> some View {
        HStack(spacing: 6) {
            HelperBadge(helper: target, size: 18)
            Text(target.name).appFont(.system(size: 12, weight: .medium)).foregroundStyle(theme.text.color)
            Glyph(systemName: "chevron.down").appFont(.system(size: 9, weight: .semibold)).foregroundStyle(theme.text3.color)
        }
        .padding(.leading, 4).padding(.trailing, 8).padding(.vertical, 3)
        .background(Capsule().fill(theme.fill2.color))
    }

    private func send(_ target: Helper?) {
        let task = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let target, !task.isEmpty else { return }
        text = ""
        model.send(.jobAdd(helper: target.id, task: task))
    }
}
