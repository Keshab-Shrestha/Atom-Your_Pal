import SwiftUI
import AtomIslandCore

// Dashboard polish (2026-10-31 UX pass): a stat tile and a smooth trend chart with a hover read-out. Ideas from EasyUI's stat card and live line chart, rebuilt on the theme's tokens
// and `Motion`'s rules. Snapshots (gallery) draw the finished state; Reduce Motion skips the draw-in.

extension View {
    /// A stat tile (EasyUI's stat card): the panel fill, a hairline, hover depth and a slight tilt.
    func statTile(attention: Bool = false) -> some View { modifier(StatTileModifier(attention: attention)) }
}

private struct StatTileModifier: ViewModifier {
    let attention: Bool
    @Environment(\.theme) private var theme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        content
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(theme.isDark ? theme.fill2.color : Color.white, in: shape)
            .overlay(shape.strokeBorder(attention ? theme.attention.color.opacity(0.5) : theme.separator.color, lineWidth: 0.6))
            .interactiveTile(radius: 12)
    }
}

/// The 7-day line: a smooth curve with a soft gradient under it, drawn in once, and a hover read-out that follows
/// the pointer to the nearest day.
struct TrendChart: View {
    let values: [Int]
    let labels: [String]
    let color: Color
    @State private var drawn = false
    @State private var hovered: Int?
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        GeometryReader { proxy in
            let points = Self.points(values, in: proxy.size)
            let progress: CGFloat = drawn || snapshot || reduceMotion ? 1 : 0
            ZStack(alignment: .topLeading) {
                Self.area(points, height: proxy.size.height)
                    .fill(LinearGradient(colors: [color.opacity(0.22), color.opacity(0)], startPoint: .top, endPoint: .bottom))
                    .opacity(progress)
                Self.curve(points)
                    .trim(from: 0, to: progress)
                    .stroke(color, style: StrokeStyle(lineWidth: 1.75, lineCap: .round, lineJoin: .round))
                ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                    Circle().fill(color).frame(width: index == hovered ? 7 : 4, height: index == hovered ? 7 : 4)
                        .overlay(Circle().strokeBorder(theme.isDark ? theme.fill2.color : .white, lineWidth: index == hovered ? 1.5 : 0))
                        .position(point).opacity(progress)
                }
                if let hovered, points.indices.contains(hovered) { readout(hovered, at: points[hovered], width: proxy.size.width) }
            }
            .contentShape(Rectangle())
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    guard values.count > 0, proxy.size.width > 0 else { return }
                    let step = values.count == 1 ? 1 : proxy.size.width / CGFloat(values.count - 1)
                    let index = values.count == 1 ? 0 : min(values.count - 1, max(0, Int((location.x / step).rounded())))
                    if hovered != index { withAnimation(Motion.track(reduceMotion)) { hovered = index } }
                case .ended:
                    withAnimation(Motion.close(reduceMotion)) { hovered = nil }
                }
            }
            .onAppear { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.8)) { drawn = true } }
        }
        .frame(height: 72)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(zip(labels, values).map { "\($0): \($1)" }.joined(separator: ", "))
    }

    private func readout(_ index: Int, at point: CGPoint, width: CGFloat) -> some View {
        VStack(spacing: 1) {
            Text(TokenTotals.short(values[index])).appFont(.system(size: 11.5, weight: .semibold)).monospacedDigit().foregroundStyle(theme.text.color)
            if labels.indices.contains(index) { Text(labels[index]).appFont(.system(size: 9.5)).foregroundStyle(theme.text2.color) }
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(theme.isDark ? theme.fill1.color : .white, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(theme.hairline(true), lineWidth: 0.6))
        .shadow(color: .black.opacity(theme.isFlat ? 0 : 0.18), radius: 6, y: 3)
        .fixedSize()
        .position(x: min(max(point.x, 36), max(36, width - 36)), y: point.y > 34 ? point.y - 24 : point.y + 24)
        .allowsHitTesting(false)
        .transition(.opacity)
    }

    private static func points(_ values: [Int], in size: CGSize) -> [CGPoint] {
        let maximum = CGFloat(max(1, values.max() ?? 1))
        let height = max(1, size.height - 8)
        return values.enumerated().map { index, value in
            CGPoint(x: values.count == 1 ? size.width / 2 : CGFloat(index) / CGFloat(values.count - 1) * size.width,
                    y: height - CGFloat(value) / maximum * height + 4)
        }
    }

    /// Cubic steps with level handles at the midpoint: smooth, and never overshoots a peak or dips below the floor.
    private static func curve(_ points: [CGPoint]) -> Path {
        Path { path in
            guard let first = points.first else { return }
            path.move(to: first)
            for index in points.indices.dropFirst() {
                let a = points[index - 1], b = points[index], mid = (a.x + b.x) / 2
                path.addCurve(to: b, control1: CGPoint(x: mid, y: a.y), control2: CGPoint(x: mid, y: b.y))
            }
        }
    }

    private static func area(_ points: [CGPoint], height: CGFloat) -> Path {
        var path = curve(points)
        guard let first = points.first, let last = points.last else { return path }
        path.addLine(to: CGPoint(x: last.x, y: height)); path.addLine(to: CGPoint(x: first.x, y: height)); path.closeSubpath()
        return path
    }
}
