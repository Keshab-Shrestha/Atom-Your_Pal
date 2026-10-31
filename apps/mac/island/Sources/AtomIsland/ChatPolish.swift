import SwiftUI
import AtomIslandCore

// Chat and composer polish (2026-10-31 UX pass): a softer focus ring and a selection that slides between menu rows.
// Ideas from Kobra's input (a focus ring that settles, not snaps), rebuilt on the theme's tokens and `Motion`.

private struct ComposerFocusModifier<S: InsettableShape>: ViewModifier {
    let focused: Bool
    let shape: S
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            // At rest the theme's border; focused, a calm accent hairline with a soft halo outside it. Void keeps
            // the hairline only (no glow, ADR-086).
            .overlay(shape.strokeBorder(focused ? theme.accent.color.opacity(0.32) : theme.border.color, lineWidth: 1))
            .background(
                shape.stroke(theme.accent.color.opacity(focused && !theme.isFlat ? 0.16 : 0), lineWidth: 6)
                    .blur(radius: 4)
                    .allowsHitTesting(false))
            .animation(Motion.settle(reduceMotion), value: focused)
    }
}

extension View {
    /// The message box's focus state: a softer ring than a hard accent outline, settling in on `Motion.settle`.
    func composerFocus(_ focused: Bool, shape: some InsettableShape) -> some View {
        modifier(ComposerFocusModifier(focused: focused, shape: shape))
    }

    /// A menu row's selection fill that slides to the next row (arrow keys, pointer) instead of jumping. Put
    /// `.animation(Motion.snap(reduceMotion), value: selected)` on the list.
    func slidingSelection(_ selected: Bool, in namespace: Namespace.ID, radius: CGFloat, fill: Color) -> some View {
        background {
            if selected {
                RoundedRectangle(cornerRadius: radius, style: .continuous).fill(fill)
                    .matchedGeometryEffect(id: "selection", in: namespace)
            }
        }
    }
}
