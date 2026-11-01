import SwiftUI
import ArkIslandCore

/// The Board's Team view (2026-11-02, after the org-chart reference Keshab chose): who works for whom, live. Keshab at the top, ARK under him,
/// and every agent under ARK on one line. A card's line lights while that agent works; the card says what it does now. A click opens the agent.
struct BoardTeamView: View {
    let model: IslandModel
    @Environment(\.theme) private var theme

    var body: some View {
        let helpers = (model.helpers.list?.helpers ?? []).filter { $0.role != "improver" }
        Scrollable {
            VStack(spacing: 0) {
                node(title: "You", detail: "Owner")
                stem(lit: model.status.isBusy)
                node(title: "ARK", detail: model.status.isBusy ? model.status.title : "Ready", lit: model.status.isBusy)
                stem(lit: helpers.contains(where: working))
                // The line the agents hang from, then the agents, wrapping onto more rows on a narrow window.
                Rectangle().fill(line(false)).frame(height: 1).frame(maxWidth: CGFloat(max(1, helpers.count - 1)) * (AgentNodeCard.width + 16))
                FlowLayout(spacing: 16, centered: true) {
                    ForEach(helpers) { helper in
                        VStack(spacing: 0) {
                            Rectangle().fill(line(working(helper))).frame(width: 1, height: 16)
                            AgentNodeCard(helper: helper) { model.navigate { model.windowPage = .agents; model.helpers.selectHelper(helper.id) } }
                        }
                    }
                }
                .padding(.horizontal, 24)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
        }
    }

    private func working(_ helper: Helper) -> Bool { helper.jobs.contains { $0.state == .running } }
    private func line(_ lit: Bool) -> Color { lit ? theme.accent.color : theme.text3.color.opacity(0.35) }
    private func stem(lit: Bool) -> some View { Rectangle().fill(line(lit)).frame(width: 1, height: 24) }

    private func node(title: String, detail: String, lit: Bool = false) -> some View {
        VStack(spacing: 2) {
            Text(title).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color)
            Text(detail).appFont(.system(size: 11)).foregroundStyle(lit ? theme.live.color : theme.text3.color).lineLimit(1)
        }
        .padding(.horizontal, 16).frame(minWidth: 140, minHeight: 48)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.fill1.color))
    }
}

/// One agent in the Team view: who it is, what it does now, and its recent record.
private struct AgentNodeCard: View {
    let helper: Helper
    let open: () -> Void
    static let width: CGFloat = 200
    @Environment(\.theme) private var theme

    var body: some View {
        let running = helper.jobs.first { $0.state == .running }
        let waiting = helper.jobs.filter { $0.state == .queued }.count
        Button(action: open) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    HelperBadge(helper: helper, size: 28)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(helper.name).appFont(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(1)
                        Text(helper.roleTitle).appFont(.system(size: 11)).foregroundStyle(theme.text3.color).lineLimit(1)
                    }
                }
                if let running {
                    Text(running.step ?? "Working").appFont(.system(size: 11)).foregroundStyle(theme.live.color).lineLimit(1)
                    Text(running.title ?? running.task).appFont(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(2)
                } else {
                    Text(helper.paused ? "Paused" : waiting > 0 ? "\(waiting) waiting" : "Idle").appFont(.system(size: 11)).foregroundStyle(theme.text3.color)
                }
                if let record = AgentStats(jobs: helper.jobs).line {
                    Text(record).appFont(.system(size: 11)).monospacedDigit().foregroundStyle(theme.text3.color).lineLimit(1)
                }
            }
            .padding(12)
            .frame(width: Self.width, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(theme.fill1.color))
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("\(helper.name), \(running?.step ?? (helper.paused ? "paused" : "idle"))")
    }
}
