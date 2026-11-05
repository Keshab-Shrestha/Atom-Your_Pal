import SwiftUI
import ArkIslandCore

/// ARK's tool and turn numbers for the last week, counted from its own log (the runtime's stats.ts). Names, counts and times only.
struct StatsSection: View {
    let model: IslandModel
    @Environment(\.theme) private var theme
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        let stats = model.stats
        Group {
            if let stats, !stats.isEmpty {
                Card("Last \(stats.days) days", footer: "Counted from ARK's own log. It holds tool names, counts and times, never what you or ARK said.") {
                    Row(title: "Tool calls", detail: stats.totalFailed == 0 ? "None failed" : "\(stats.totalFailed) failed") { value("\(stats.totalCalls)") }
                    RowDivider()
                    Row(title: "Answers", detail: stats.slowTurns == 0 ? "None slow" : "\(stats.slowTurns) took 15 s or more") { value("\(stats.turns)") }
                    RowDivider()
                    Row(title: "Time to answer", detail: "On average") { value(ToolStats.duration(stats.avgTurnMs)) }
                }
                Card("Tools") {
                    ForEach(Array(stats.tools.enumerated()), id: \.element.id) { index, tool in
                        if index > 0 { RowDivider() }
                        Row(title: tool.name, detail: detail(tool)) { value("\(tool.calls)") }
                    }
                }
            } else {
                Card("Last 7 days", footer: "Numbers appear after ARK has run some tools.") {
                    Row(title: stats == nil ? "Loading" : "Nothing to show yet", detail: "") { EmptyView() }
                }
            }
        }
        .onAppear { if !snapshot { model.loadStats() } }
    }

    private func detail(_ tool: ToolStatRow) -> String {
        var parts = [tool.failureText, "about \(ToolStats.duration(tool.avgMs))"]
        if tool.repeats > 0 { parts.append("\(tool.repeats) repeated") }
        return parts.joined(separator: " · ")
    }

    private func value(_ text: String) -> some View {
        Text(text).appFont(.system(size: 13, weight: .medium)).foregroundStyle(theme.text.color).monospacedDigit()
    }
}
