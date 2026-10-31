import SwiftUI

// One shared set of press, hover-depth and pointer-tilt rules (2026-10-31 UX pass). Ideas from web component
// libraries (Aceternity's 3D tilt and wobble cards, Kobra's springing focus ring), rebuilt in SwiftUI on
// `Motion`'s springs and the theme's tokens. Every rule takes Reduce Motion: nothing moves, only colour and
// shadow change over a plain 150 ms ease-out. Void (flat) themes get no shadow and no sheen, only the hairline.

extension Motion {
    /// A pressed control shrinks to this scale (ADR-084 names it; the shared button style now does it).
    static let pressScale: CGFloat = 0.97
    /// A hovered card rises this many points.
    static let liftHeight: CGFloat = 1.5
    /// The largest tilt of a card under the pointer, in degrees. Small on purpose: calm, not flashy.
    static let tiltDegrees: Double = 2.5

    /// A control being pressed or released.
    static func press(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .spring(response: 0.16, dampingFraction: 0.78)
    }

    /// A card rising under the pointer, and settling back.
    static func lift(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .spring(response: 0.28, dampingFraction: 0.82)
    }

    /// A card following the pointer: quick, no overshoot, so the tilt never wobbles.
    static func tilt(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .interactiveSpring(response: 0.20, dampingFraction: 0.90)
    }

    /// A new row, bubble or card arriving in a list: a short rise and fade. Pair it with `arrive` as its animation.
    static func arrival(_ reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 6)).combined(with: .scale(scale: 0.985, anchor: .top))
    }
    static func arrive(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .spring(response: 0.38, dampingFraction: 0.8)
    }
}

// MARK: - Press

/// The app's button feedback: the label shrinks to `Motion.pressScale` while pressed. Use in place of `.plain`.
struct PressableButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PressBody(configuration: configuration)
    }

    private struct PressBody: View {
        let configuration: ButtonStyle.Configuration
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            configuration.label
                .scaleEffect(configuration.isPressed && !reduceMotion ? Motion.pressScale : 1)
                .animation(Motion.press(reduceMotion), value: configuration.isPressed)
        }
    }
}

extension ButtonStyle where Self == PressableButtonStyle {
    static var pressable: PressableButtonStyle { PressableButtonStyle() }
}

// MARK: - Hover depth

private struct HoverLiftModifier: ViewModifier {
    let radius: CGFloat
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let on = hovering.wrappedValue
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .overlay(shape.strokeBorder(theme.hairline(on).opacity(on ? 1 : 0), lineWidth: 1).allowsHitTesting(false))
            .shadow(color: .black.opacity(on && !theme.isFlat ? (theme.isDark ? 0.34 : 0.12) : 0), radius: on ? 12 : 0, y: on ? 6 : 0)
            .offset(y: on && !reduceMotion ? -Motion.liftHeight : 0)
            .onHover { hovering.wrappedValue = $0 }
            .animation(Motion.lift(reduceMotion), value: on)
    }
}

// MARK: - Pointer tilt

private struct TiltSizeKey: PreferenceKey {
    static let defaultValue = CGSize.zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() }
}

private struct PointerTiltModifier: ViewModifier {
    let radius: CGFloat
    let degrees: Double
    /// Pointer position in the card's unit square (0...1), or nil while the pointer is away.
    private let pointer = State<CGPoint?>(initialValue: nil)
    private let size = State(initialValue: CGSize.zero)
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            let unit = pointer.wrappedValue
            let dx = unit.map { ($0.x - 0.5) * 2 } ?? 0
            let dy = unit.map { ($0.y - 0.5) * 2 } ?? 0
            content
                .overlay { sheen(unit) }
                .background(GeometryReader { Color.clear.preference(key: TiltSizeKey.self, value: $0.size) })
                .onPreferenceChange(TiltSizeKey.self) { size.wrappedValue = $0 }
                .rotation3DEffect(.degrees(-dy * degrees), axis: (x: 1, y: 0, z: 0), perspective: 0.7)
                .rotation3DEffect(.degrees(dx * degrees), axis: (x: 0, y: 1, z: 0), perspective: 0.7)
                .animation(Motion.tilt(false), value: unit)
                .onContinuousHover { phase in
                    switch phase {
                    case .active(let point):
                        let box = size.wrappedValue
                        guard box.width > 0, box.height > 0 else { return }
                        pointer.wrappedValue = CGPoint(x: min(1, max(0, point.x / box.width)), y: min(1, max(0, point.y / box.height)))
                    case .ended:
                        pointer.wrappedValue = nil
                    }
                }
        }
    }

    /// A faint pool of light under the pointer, like light moving over glass. None in flat themes.
    @ViewBuilder private func sheen(_ unit: CGPoint?) -> some View {
        if let unit, !theme.isFlat {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(RadialGradient(colors: [Color.white.opacity(theme.isDark ? 0.07 : 0.14), .clear],
                                     center: UnitPoint(x: unit.x, y: unit.y), startRadius: 0, endRadius: 140))
                .allowsHitTesting(false)
        }
    }
}

extension View {
    /// Hover depth for a card or tile: a hairline, a soft shadow and a 1.5 pt rise. With Reduce Motion only the
    /// hairline and shadow change.
    func hoverLift(radius: CGFloat = 12) -> some View { modifier(HoverLiftModifier(radius: radius)) }

    /// A slight 3D tilt toward the pointer with a moving sheen (Aceternity's tilt card, much quieter). Off with
    /// Reduce Motion. Use on tiles the size of a card, never on a whole page or a list.
    func pointerTilt(radius: CGFloat = 12, degrees: Double = Motion.tiltDegrees) -> some View {
        modifier(PointerTiltModifier(radius: radius, degrees: degrees))
    }

    /// The tile treatment: hover depth and pointer tilt together.
    func interactiveTile(radius: CGFloat = 12) -> some View { pointerTilt(radius: radius).hoverLift(radius: radius) }
}
