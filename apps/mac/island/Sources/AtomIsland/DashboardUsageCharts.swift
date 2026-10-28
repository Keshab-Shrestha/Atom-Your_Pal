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
            HStack(alignment: .center, spacing: 16) { ring; legend }.frame(minWidth: 330)
            VStack(alignment: .leading, spacing: 14) { ring; legend }
        }
    }
    private var ring: some View {
        ZStack {
            Circle().stroke(theme.fill3.color, lineWidth: 14)
            ForEach(parts.indices, id: \.self) { index in
                let total = max(1, usage.week.total)
                let start = Double(parts.prefix(index).reduce(0) { $0 + $1.1 }) / Double(total)
                let end = start + Double(parts[index].1) / Double(total)
                if end > start {
                    Circle().trim(from: start, to: end).stroke(parts[index].2, style: StrokeStyle(lineWidth: 14, lineCap: .butt)).rotationEffect(.degrees(-90))
                }
            }
            VStack(spacing: 3) {
                Text(TokenTotals.short(usage.week.total)).appFont(.system(size: 20, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
                Text("total tokens").appFont(.system(size: 10)).foregroundStyle(theme.text2.color)
            }
        }.frame(width: 112, height: 112).padding(8)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Seven-day token mix. " + parts.map { "\($0.0): \($0.1)" }.joined(separator: ", "))
    }
    private var legend: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(parts.indices, id: \.self) { index in
                let part = parts[index]
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Circle().fill(part.2).frame(width: 6, height: 6).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                        Text(part.0).appFont(.system(size: 11)).foregroundStyle(theme.text2.color).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(TokenTotals.short(part.1)).appFont(.system(size: 12, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
                        Text(TokenTotals.sharePercent(part.1, of: usage.week.total)).appFont(.system(size: 11)).monospacedDigit()
                            .foregroundStyle(theme.text3.color).frame(minWidth: 38, alignment: .trailing)
                    }
                    ShareBar(fraction: Double(part.1) / Double(max(1, usage.week.total)), color: part.2)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(part.0): \(TokenTotals.short(part.1)), \(TokenTotals.sharePercent(part.1, of: usage.week.total)) of the total")
            }
            if usage.week.total == 0 {
                Text("No usage recorded.").appFont(.system(size: 11)).foregroundStyle(theme.text2.color)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A thin bar for a kind's share of the total. A share that exists is never drawn thinner than 3 points.
private struct ShareBar: View {
    let fraction: Double
    let color: Color
    @Environment(\.theme) private var theme
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(theme.fill3.color)
                if fraction > 0 {
                    Capsule().fill(color).frame(width: max(3, geometry.size.width * min(1, fraction)))
                }
            }
        }.frame(height: 5).accessibilityHidden(true)
    }
}
