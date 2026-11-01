import SwiftUI
import ArkIslandCore

// One shared set of press, hover and arrival rules (2026-10-31 UX pass; tilt and lift removed by the unslop pass). Ideas from web component
// libraries (Aceternity's 3D tilt and wobble cards, Kobra's springing focus ring), rebuilt in SwiftUI on
// `Motion`'s springs and the theme's tokens. Every rule takes Reduce Motion: nothing moves, only colour and
// shadow change over a plain 150 ms ease-out. Void (flat) themes get no shadow and no sheen, only the hairline.

extension Motion {
    /// A pressed control shrinks to this scale (ADR-084 names it; the shared button style now does it).
    static let pressScale: CGFloat = 0.97

    /// A control being pressed or released.
    static func press(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .spring(response: 0.16, dampingFraction: 1)
    }

    /// A card rising under the pointer, and settling back.
    static func lift(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .spring(response: 0.28, dampingFraction: 1)
    }

    /// Something that follows the pointer (a chart read-out): quick, no overshoot.
    static func track(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .interactiveSpring(response: 0.20, dampingFraction: 1)
    }

    /// A new row, bubble or card arriving in a list: a short rise and fade. Pair it with `arrive` as its animation.
    static func arrival(_ reduceMotion: Bool) -> AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 6)).combined(with: .scale(scale: 0.985, anchor: .top))
    }
    static func arrive(_ reduceMotion: Bool) -> Animation {
        reduceMotion ? plain : .spring(response: 0.38, dampingFraction: 1)
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
                        .onHover { hovering.wrappedValue = $0 }
            .animation(Motion.lift(reduceMotion), value: on)
    }
}

// MARK: - Row hover

private struct HoverRowModifier: ViewModifier {
    let radius: CGFloat
    private let hovering = State(initialValue: false)
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(theme.fill2.color.opacity(hovering.wrappedValue ? 1 : 0)).allowsHitTesting(false))
            .onHover { hovering.wrappedValue = $0 }
            .animation(Motion.hover(reduceMotion, ghost: theme.isGhost), value: hovering.wrappedValue)
    }
}

extension View {
    /// Hover on a card or tile: its hairline brightens. Nothing moves and no shadow grows (unslop: a colour or
    /// surface step on hover, not a lift).
    func hoverLift(radius: CGFloat = 12) -> some View { modifier(HoverLiftModifier(radius: radius)) }


    /// A list row under the pointer: the theme's hover fill fades in behind it. Nothing moves.
    func hoverRow(radius: CGFloat = 0) -> some View { modifier(HoverRowModifier(radius: radius)) }

    /// The tile treatment: the hairline brightens under the pointer. No tilt or rise (unslop, 2026-10-31).
    func interactiveTile(radius: CGFloat = 12) -> some View { hoverLift(radius: radius) }
}
