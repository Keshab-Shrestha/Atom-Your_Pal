import SwiftUI
import ArkIslandCore

// ADR-273 (design reference: Ghostex, MIT; redrawn in ARK's tokens): the Workers card under a chat's latest turn. One row for
// each Board job this chat started: its state glyph, its short title and one line of its latest step or report. A job an agent
// started sits under that agent. A row opens the task. Past five rows the card folds. It only reads: nothing here starts or stops work.

struct ChatAgentWorkView: View {
    let model: IslandModel
    @State private var folded = false
    @State private var showAll = false
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let rows = ChatAgentWork.rows(helpers: model.helpers.list?.helpers ?? [], chat: model.chats?.current)
        if !rows.isEmpty {
            let live = rows.contains { $0.state.isActive } // the clocks tick while any job is open
            let working = rows.filter { $0.state == .running }.count
            let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
            VStack(alignment: .leading, spacing: 0) {
                header(count: rows.count, working: working)
                if !folded {
                    Rectangle().fill(theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5)
                    let fold = WorkersFold.shown(rows, showAll: showAll)
                    Group {
                        if live, !snapshot {
                            TimelineView(.periodic(from: .now, by: 1)) { context in list(fold.rows, now: context.date) }
                        } else {
                            list(fold.rows, now: Date())
                        }
                    }
                    .padding(.vertical, 4)
                    if rows.count > WorkersFold.limit { foldButton(hidden: fold.hidden) }
                }
            }
            .background(shape.fill(theme.fill1.color))
            .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
            .clipShape(shape)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Workers in this chat")
        }
    }

    private func header(count: Int, working: Int) -> some View {
        Button { folded.toggle() } label: {
            HStack(spacing: 8) {
                Glyph(systemName: "person.2").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text2.color)
                Text("Workers").appFont(.system(size: 12, weight: .semibold)).foregroundStyle(theme.text.color)
                Text(working > 0 ? "\(working) of \(count) working" : "\(count) finished")
                    .appFont(.system(size: 11.5)).monospacedDigit().foregroundStyle(theme.text3.color)
                Spacer(minLength: 8)
                Glyph(systemName: folded ? "chevron.down" : "chevron.up").appFont(.system(size: 9, weight: .semibold)).foregroundStyle(theme.text3.color)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Workers, \(working) of \(count) working")
        .accessibilityValue(folded ? "Collapsed" : "Expanded")
    }

    private func list(_ rows: [ChatAgentRow], now: Date) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
                WorkerRowView(row: row, now: now) {
                    model.navigate { model.windowPage = .agents; model.sendHelpers(model.helpers.openThread(row.id)) }
                }
            }
        }
    }

    private func foldButton(hidden: Int) -> some View {
        Button { showAll.toggle() } label: {
            Text(showAll ? "Show fewer" : "Show all (\(hidden) more)")
                .appFont(.system(size: 11.5, weight: .medium)).foregroundStyle(theme.text2.color)
                .padding(.horizontal, 12).padding(.top, 2).padding(.bottom, 8)
                .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct WorkerRowView: View {
    let row: ChatAgentRow
    let now: Date
    let open: () -> Void
    @Environment(\.theme) private var theme

    var body: some View {
        Button(action: open) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                WorkerMarkGlyph(mark: row.mark).frame(width: 12)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(row.task).appFont(.system(size: 12.5, weight: .medium)).foregroundStyle(theme.text.color).lineLimit(1).truncationMode(.tail)
                        if row.workers > 0 {
                            Glyph(systemName: "crown").appFont(.system(size: 9.5)).foregroundStyle(theme.text3.color)
                                .help("Manager: started \(JobTree.workersText(row.workers))")
                        }
                        Text(row.agent).appFont(.system(size: 11.5)).foregroundStyle(theme.text3.color).lineLimit(1).layoutPriority(-1)
                        if row.quietSince != nil { QuietDot() }
                    }
                    if let line = row.line {
                        Text(line).appFont(.system(size: 11.5)).foregroundStyle(row.mark == .failed ? theme.problem.color : theme.text2.color)
                            .lineLimit(1).truncationMode(.tail)
                    }
                }
                Spacer(minLength: 8)
                if let elapsed { Text(elapsed).appFont(.system(size: 11)).monospacedDigit().foregroundStyle(theme.text3.color) }
            }
            .padding(.horizontal, 12).padding(.vertical, 5)
            // A job an agent started sits under that agent, with a guide line (2026-11-02).
            .padding(.leading, CGFloat(row.depth) * 18)
            .overlay(alignment: .leading) {
                if row.depth > 0 {
                    Rectangle().fill(theme.separator.color).frame(width: 1).padding(.leading, CGFloat(row.depth) * 18)
                }
            }
            .contentShape(Rectangle())
            .hoverRow()
        }
        .buttonStyle(.plain)
        .help("Open the task")
        .accessibilityLabel("\(row.task), \(row.agent), \(row.mark.title)\(row.quietSince != nil ? ", no new output for 8 minutes" : ""), \(row.line ?? "")")
    }

    /// How long it has run, or ran.
    private var elapsed: String? {
        guard let start = row.startedAt else { return nil }
        return ChatWorkText.duration(ms: max(0, (row.endedAt ?? now).timeIntervalSince(start)) * 1000)
    }
}

/// ADR-273: a worker's state as one glyph: a spinner while it runs, "?" in the accent when it needs Keshab, then how it ended.
struct WorkerMarkGlyph: View {
    let mark: WorkerMark
    @Environment(\.theme) private var theme

    var body: some View {
        switch mark {
        case .running: WorkingGlyph()
        case .needsYou: Glyph(systemName: "questionmark").appFont(.system(size: 10, weight: .bold)).foregroundStyle(theme.accent.color)
        case .queued: Glyph(systemName: "clock").appFont(.system(size: 10)).foregroundStyle(theme.text3.color)
        case .done: Glyph(systemName: "checkmark").appFont(.system(size: 10, weight: .semibold)).foregroundStyle(theme.success.color)
        case .failed: Glyph(systemName: "exclamationmark").appFont(.system(size: 10, weight: .semibold)).foregroundStyle(theme.problem.color)
        case .stopped: Glyph(systemName: "stop").appFont(.system(size: 9)).foregroundStyle(theme.text3.color)
        }
    }
}

/// ADR-273: the stuck dot. A red dot on a running job with no tool call or progress for 8 minutes.
struct QuietDot: View {
    @Environment(\.theme) private var theme

    var body: some View {
        Circle().fill(theme.problem.color).frame(width: 6, height: 6)
            .help(JobTree.quietTip)
            .accessibilityLabel(JobTree.quietTip)
    }
}
