import SwiftUI
import AtomIslandCore

/// A composition chart, not a budget/progress ring. The total includes cache tokens.
struct DashboardTokenMix: View {
    let usage: TokenUsageSummary
    @Environment(\.theme) private var theme
    private var parts: [(String, Int, Color)] {
        [("Input + output", usage.week.io, theme.live.color),
         ("Cache written", usage.week.cacheWrite, theme.text2.color),
         ("Cache read", usage.week.cacheRead, theme.success.color)]
    }
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 20) { ring; legend }.frame(minWidth: 330)
            VStack(alignment: .leading, spacing: 14) { ring; legend }
        }
    }
    private var ring: some View {
        ZStack {
            Circle().stroke(theme.text3.color, lineWidth: 16)
            ForEach(parts.indices, id: \.self) { index in
                let total = max(1, usage.week.total)
                let start = Double(parts.prefix(index).reduce(0) { $0 + $1.1 }) / Double(total)
                let end = start + Double(parts[index].1) / Double(total)
                if end > start {
                    Circle().trim(from: start, to: end).stroke(parts[index].2, style: StrokeStyle(lineWidth: 16, lineCap: .butt)).rotationEffect(.degrees(-90))
                }
            }
            VStack(spacing: 3) {
                Text(TokenTotals.short(usage.week.total)).appFont(.system(size: 20, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
                Text("total tokens").appFont(.system(size: 10)).foregroundStyle(theme.text2.color)
            }
        }.frame(width: 120, height: 120).padding(8)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Seven-day token mix. " + parts.map { "\($0.0): \($0.1)" }.joined(separator: ", "))
    }
    private var legend: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(parts.indices, id: \.self) { index in
                HStack(alignment: .top, spacing: 7) {
                    Circle().fill(parts[index].2).frame(width: 6, height: 6).padding(.top, 4)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(parts[index].0).appFont(.system(size: 11))
                        Text(TokenTotals.short(parts[index].1)).appFont(.system(size: 12, weight: .semibold)).monospacedDigit()
                    }
                }.foregroundStyle(theme.text2.color)
            }
            if usage.week.total == 0 {
                Text("No usage recorded.").appFont(.system(size: 11)).foregroundStyle(theme.text2.color)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
