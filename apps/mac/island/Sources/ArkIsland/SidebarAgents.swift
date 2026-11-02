import SwiftUI
import ArkIslandCore

/// The sidebar's agents (2026-11-02, after Keshab's "Agent CRM workspace" reference): each with a live dot, the ones that wait
/// for Keshab first. A click opens the agent's page; + makes a new agent. Tinker only reviews, so it is not listed.
struct SidebarAgents: View {
    let model: IslandModel
    /// The most rows before "All agents".
    static let shown = 6
    @Environment(\.theme) private var theme

    var body: some View {
        let helpers = (model.helpers.list?.helpers ?? []).filter { $0.role != "improver" }
            .sorted { (AgentPresence($0).rank, $0.name) < (AgentPresence($1).rank, $1.name) }
        if !helpers.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text("Agents").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                    Spacer()
                    Button { model.navigate { model.helpers.openNewAgent() } } label: {
                        Glyph(systemName: "plus").appFont(.system(size: 11, weight: .medium)).foregroundStyle(theme.text3.color)
                            .frame(width: 22, height: 22).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).help("New agent").accessibilityLabel("New agent")
                }
                .padding(.horizontal, 8)
                ForEach(helpers.prefix(Self.shown)) { helper in AgentRow(model: model, helper: helper) }
                if helpers.count > Self.shown {
                    Button("All \(helpers.count) agents") { model.showsAllAgents = true }
                        .buttonStyle(.plain).appFont(.system(size: 11.5)).foregroundStyle(theme.text2.color).padding(.horizontal, 8).padding(.top, 2)
                }
            }
            .padding(.top, 8)
        }
    }
}

private struct AgentRow: View {
    let model: IslandModel
    let helper: Helper
    @State private var hovering = false
    @Environment(\.theme) private var theme

    var body: some View {
        let presence = AgentPresence(helper)
        Button { model.navigate { model.windowPage = .agents; model.helpers.selectHelper(helper.id) } } label: {
            HStack(spacing: 8) {
                HelperBadge(helper: helper, size: 18)
                Text(helper.name).appFont(.system(size: 12.5)).foregroundStyle(theme.text.color).lineLimit(1)
                Spacer(minLength: 0)
                PresenceDot(presence: presence)
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: Radius.card).fill(hovering ? theme.fill1.color : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help("\(helper.name): \(presence.title)")
        .accessibilityLabel("\(helper.name), \(presence.title)")
    }
}

/// Green and pulsing while it works, amber when it waits for Keshab, an empty ring when paused, grey when idle.
private struct PresenceDot: View {
    let presence: AgentPresence
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            switch presence {
            case .working:
                Circle().fill(theme.success.color)
                    .phaseAnimator(snapshot || reduceMotion ? [1.0] : [1.0, 0.4]) { dot, phase in dot.opacity(phase) } animation: { _ in .easeInOut(duration: 0.9) }
            case .waiting: Circle().fill(theme.attention.color)
            case .paused: Circle().strokeBorder(theme.text3.color, lineWidth: 1)
            case .idle: Circle().fill(theme.text3.color.opacity(0.5))
            }
        }
        .frame(width: 6, height: 6)
        .accessibilityHidden(true)
    }
}
