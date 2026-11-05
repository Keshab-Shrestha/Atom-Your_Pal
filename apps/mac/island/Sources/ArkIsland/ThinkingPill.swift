import SwiftUI
import ArkIslandCore

// Ported in SwiftUI from affectUI's Thinking Loader and Tool Call Card (MIT, (c) 2026 Florian Höller, github.com/flohoeller/affectui):
// their look and motion, not their code. ARK's labels come from what the turn really does, never from phases on a timer.

/// A thin eight-ray spinner: one ray bright, the rest fading behind it as it turns. Still under Reduce Motion and in snapshots.
struct RaySpinner: View {
    var size: CGFloat = 12
    var color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 10, paused: reduceMotion || snapshot)) { context in
            let head = reduceMotion || snapshot ? 0 : Int(context.date.timeIntervalSinceReferenceDate * 10) % 8
            ZStack {
                ForEach(0..<8, id: \.self) { ray in
                    Capsule()
                        .fill(color.opacity(0.18 + 0.82 * Double((ray - head + 8) % 8) / 7))
                        .frame(width: max(1.2, size * 0.13), height: size * 0.3)
                        .offset(y: -size * 0.33)
                        .rotationEffect(.degrees(Double(ray) * 45))
                }
            }
            .frame(width: size, height: size)
        }
        .accessibilityHidden(true)
    }
}

/// "ARK is working" as a small pill: the spinner and a quiet label with a brighter band sweeping over it. When the label changes
/// ("Thinking" → "Reading a file"), the old one rolls up and out, the new one rolls in, and the pill glides to its new width.
struct ThinkingPill: View {
    let label: String
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.islandSnapshot) private var snapshot

    var body: some View {
        HStack(spacing: 8) {
            RaySpinner(size: 12, color: theme.accent.color)
            ZStack(alignment: .leading) {
                shimmering(label)
                    .id(label)
                    .transition(reduceMotion ? .opacity : .asymmetric(
                        insertion: .move(edge: .bottom).combined(with: .opacity),
                        removal: .move(edge: .top).combined(with: .opacity)))
            }
            .clipped()
        }
        .padding(.leading, 10).padding(.trailing, 12).padding(.vertical, 6)
        .background(Capsule().fill(theme.fill1.color))
        .overlay(Capsule().strokeBorder(theme.separator.color, lineWidth: 0.8))
        .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.42, dampingFraction: 0.86), value: label)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(.updatesFrequently)
    }

    /// The label in a quiet colour, with a band of the full text colour passing over it every 1.6 s.
    private func shimmering(_ text: String) -> some View {
        let base = Text(text).appFont(.system(size: 12, weight: .medium)).lineLimit(1)
        return base.foregroundStyle(theme.text3.color)
            .overlay {
                if !(reduceMotion || snapshot) {
                    TimelineView(.animation(minimumInterval: 1 / 30)) { context in
                        let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.6) / 1.6
                        GeometryReader { proxy in
                            let band = max(24, proxy.size.width * 0.45)
                            LinearGradient(colors: [.clear, theme.text.color, .clear], startPoint: .leading, endPoint: .trailing)
                                .frame(width: band)
                                .offset(x: -band + (proxy.size.width + band * 2) * t)
                        }
                        .mask(base)
                    }
                }
            }
    }
}
