import SwiftUI
import AtomIslandCore

/// A composition chart, not a budget/progress ring. The total includes cache tokens.
struct DashboardTokenMix: View {
    let usage: TokenUsageSummary
    /// The part under the pointer, in the ring or the legend: the others dim and the centre shows its numbers.
    @State private var hovered: Int?
    @State private var drawn = false
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot
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
                let progress: Double = drawn || snapshot || reduceMotion ? 1 : 0
                if end > start {
                    Circle().trim(from: start * progress, to: end * progress)
                        .stroke(parts[index].2, style: StrokeStyle(lineWidth: hovered == index ? 17 : 14, lineCap: .butt))
                        .rotationEffect(.degrees(-90))
                        .opacity(hovered == nil || hovered == index ? 1 : 0.3)
                }
            }
            VStack(spacing: 3) {
                let focus = hovered.map { parts[$0] }
                Text(TokenTotals.short(focus?.1 ?? usage.week.total)).appFont(.system(size: 20, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
                    .contentTransition(.numericText())
                Text(focus.map { $0.0.lowercased() } ?? "total tokens").appFont(.system(size: 10)).foregroundStyle(theme.text2.color).lineLimit(1)
            }.frame(width: 84)
        }.frame(width: 112, height: 112).padding(8)
            .animation(Motion.snap(reduceMotion), value: hovered)
            .onAppear { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.9)) { drawn = true } }
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
                .padding(.horizontal, 6).padding(.vertical, 4)
                .background(theme.fill3.color.opacity(hovered == index ? 1 : 0), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .padding(.horizontal, -6).padding(.vertical, -4)
                .contentShape(Rectangle())
                .onHover { inside in hovered = inside ? index : (hovered == index ? nil : hovered) }
                .animation(Motion.hover(reduceMotion, ghost: theme.isGhost), value: hovered)
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
struct ShareBar: View {
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
