import SwiftUI
import ArkIslandCore

// The agents ARK started from this chat, under its latest turn (2026-11-01): each one's live step while it works,
// then its report's line. A row opens to the task and a link to its full thread (every tool call) on the Agents page.
// It only reads: nothing here starts or stops work.

struct ChatAgentWorkView: View {
    let model: IslandModel
    @State private var openRow: Int?
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let rows = ChatAgentWork.rows(helpers: model.helpers.list?.helpers ?? [], chat: model.chats?.current)
        if !rows.isEmpty {
            let working = rows.filter { $0.state.isActive }.count
            VStack(alignment: .leading, spacing: 2) {
                Text(working > 0 ? "Agents · \(working) working" : "Agents · finished")
                    .appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text2.color)
                    .padding(.bottom, 2)
                if working > 0, !snapshot {
                    TimelineView(.periodic(from: .now, by: 1)) { context in list(rows, now: context.date) }
                } else {
                    list(rows, now: Date())
                }
            }
            .padding(.trailing, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Agents in this chat")
        }
    }

    private func list(_ rows: [ChatAgentRow], now: Date) -> some View {
        ForEach(rows) { row in
            ChatAgentRowView(row: row, now: now, open: openRow == row.id,
                             toggle: { openRow = openRow == row.id ? nil : row.id },
                             thread: { model.navigate { model.windowPage = .agents; model.sendHelpers(model.helpers.openThread(row.id)) } })
        }
    }
}

private struct ChatAgentRowView: View {
    let row: ChatAgentRow
    let now: Date
    let open: Bool
    let toggle: () -> Void
    let thread: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: toggle) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    mark.frame(width: 12)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 8) {
                            Text(row.agent).appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color)
                            Text(row.task).appFont(.system(size: 12)).foregroundStyle(theme.text2.color).lineLimit(1).truncationMode(.tail)
                        }
                        if let detail = row.detail {
                            Text(detail).appFont(.system(size: 11.5)).foregroundStyle(row.state == .failed ? theme.problem.color : theme.text3.color)
                                .lineLimit(open ? nil : 1).truncationMode(.tail)
                        }
                    }
                    Spacer(minLength: 8)
                    if let elapsed { Text(elapsed).appFont(.system(size: 11)).monospacedDigit().foregroundStyle(theme.text3.color) }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(row.agent), \(row.state.title), \(row.detail ?? row.task)")
            .accessibilityValue(open ? "Expanded" : "Collapsed")
            if open {
                VStack(alignment: .leading, spacing: 8) {
                    Text(row.task).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).textSelection(.enabled)
                    QuietButton(title: "Open full thread", symbol: "arrow.up.right", action: thread)
                }
                .padding(.leading, 20)
            }
        }
        .padding(.vertical, 4)
        // A sub-agent sits under the agent that started it, with a guide line (2026-11-02).
        .padding(.leading, CGFloat(row.depth) * 20)
        .overlay(alignment: .leading) {
            if row.depth > 0 {
                Rectangle().fill(theme.separator.color).frame(width: 1).padding(.leading, CGFloat(row.depth) * 20 - 14)
            }
        }
    }

    @ViewBuilder private var mark: some View {
        switch row.state {
        case .running: WorkingGlyph()
        case .queued: Glyph(systemName: "clock").appFont(.system(size: 10)).foregroundStyle(theme.text3.color)
        case .done: Glyph(systemName: "checkmark").appFont(.system(size: 10, weight: .semibold)).foregroundStyle(theme.text2.color)
        case .failed: Glyph(systemName: "exclamationmark").appFont(.system(size: 10, weight: .semibold)).foregroundStyle(theme.problem.color)
        case .stopped: Glyph(systemName: "stop").appFont(.system(size: 9)).foregroundStyle(theme.text3.color)
        }
    }

    /// How long it has run, or ran.
    private var elapsed: String? {
        guard let start = row.startedAt else { return nil }
        let seconds = max(0, Int((row.endedAt ?? now).timeIntervalSince(start)))
        return seconds >= 60 ? "\(seconds / 60)m \(seconds % 60)s" : "\(seconds)s"
    }
}
