import SwiftUI
import ArkIslandCore

/// ADR-256: the Board's Flow. One view replaces the Needs you and Tasks tabs on a wide window: four lanes side by side, read left to
/// right as the work moves. Needs you (decisions and failed tasks, answered in place), Running, To do, Done. A card opens the task's
/// inspector over the right of the lanes; a second click or ✕ closes it. Each lane scrolls by itself, so the page never does.
struct BoardFlow: View {
    let model: IslandModel
    let board: [(column: BoardColumn, items: [BoardItem])]
    @State private var inspected: Int?
    @Environment(\.theme) private var theme

    static let laneSpacing: CGFloat = 12
    static let inspectorWidth: CGFloat = 360

    var body: some View {
        let attention = BoardAttention(list: model.helpers.list, approvalPending: model.approval.pending != nil)
        let chosen = inspected.flatMap { id in board.flatMap(\.items).first { $0.id == id } }
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
                        Scrollable {
                            VStack(spacing: 8) {
                                ForEach(items) { item in
                                    FlowCard(model: model, item: item, selected: chosen?.id == item.id) {
                                        inspected = inspected == item.id ? nil : item.id
                                    }
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
                .frame(width: Self.inspectorWidth)
                .frame(maxHeight: .infinity, alignment: .top)
                .floatingSurface(RoundedRectangle(cornerRadius: theme.radiusCard + 6, style: .continuous))
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: inspected)
        .onExitCommand { inspected = nil }
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
    let choose: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard + 2, style: .continuous)
        Button(action: choose) {
            BoardCard(model: model, item: item)
                .background(shape.fill(selected ? theme.fill3.color : theme.fill2.color))
                .overlay(shape.strokeBorder(selected ? theme.accent.color.opacity(0.6) : theme.separator.color, lineWidth: selected ? 1.2 : 0.6))
                .clipShape(shape)
        }
        .buttonStyle(.pressable)
        .accessibilityAddTraits(selected ? .isSelected : [])
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
