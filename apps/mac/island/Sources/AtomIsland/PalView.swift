import SwiftUI
import AtomIslandCore

/// Pal on screen (ADR-093, drawn smooth by ADR-104): ZENO's own 2D character, drawn from Pal's file
/// (`assets/pals/pal.json`) by `PalDrawing` as antialiased vector shapes. Its mood and reactions come from
/// `PalStanceMotion`, a pure function of `time`, so one clock drives it and the gallery can render any moment exactly. No glow, no leaning.
///
/// The view is `size * 1.5` square with a margin of `size / 4`, and Pal's feet sit at 61/64 of `size` below the
/// margin, as before, so walking, dragging and pointing place it the same way.
struct PalView: View {
    /// The margin around the drawing for a given size.
    static func margin(for size: CGFloat) -> CGFloat { size / 4 }
    /// Where Pal's feet are, measured from the bottom of the view.
    static func groundInset(for size: CGFloat) -> CGFloat { size * 1.5 - (margin(for: size) + size * 61 / 64) }
    /// The bottom of the feet on the 32-unit grid.
    static let spriteFeet: CGFloat = 28.5

    var mood: PetBrain.Mood
    /// Seconds, from any steady clock.
    var time: Double
    /// +1 facing right, -1 facing left.
    var facing: Double = 1
    var size: CGFloat = 64
    /// ADR-073, while ZENO is idle: where the eyes look toward the pointer (design points, y down), how much the
    /// pointer is over Pal (0...1), and the reaction playing with how far through it is (0...1).
    var gaze = CGSize.zero
    var hover: Double = 0
    var reaction: PalReaction?
    var reactionProgress: Double = 0
    /// ADR-093: the microphone is capturing while Pal listens ("Speak now").
    var micLive = false
    @Environment(\.theme) private var theme

    var body: some View {
        let frame = PalStanceMotion.frame(mood: mood, time: time, gazeX: gaze.width, micLive: micLive, reaction: reaction, progress: reactionProgress)
        // One grid unit in points: smooth vector art, so any size is as sharp as any other.
        let unit = size / CGFloat(PalStance.size)
        let sprite = CGFloat(PalStance.size) * unit
        let feetY = Self.margin(for: size) + size * 61 / 64
        // Eyes are drawn in the sprite's own direction: mirrored when Pal faces left.
        let flipped = facing < 0
        ZStack(alignment: .topLeading) {
            if let pal = PalLibrary.pal {
                Canvas { context, _ in
                    var ctx = context
                    let origin = CGPoint(x: (size * 1.5 - sprite) / 2, y: feetY - Self.spriteFeet * unit)
                    let anchor = CGPoint(x: origin.x + sprite / 2, y: origin.y + Self.spriteFeet * unit)
                    let grow = 1 + hover * 0.05
                    ctx.translateBy(x: 0, y: CGFloat(frame.bob) * unit)
                    ctx.translateBy(x: anchor.x, y: anchor.y)
                    ctx.rotate(by: .degrees(frame.wobble))
                    ctx.scaleBy(x: (flipped ? -1 : 1) * frame.squashX * grow, y: frame.squashY * grow)
                    ctx.translateBy(x: -anchor.x, y: -anchor.y)
                    PalDrawing.draw(pal, pose: frame.pose, look: flipped ? -frame.look : frame.look, in: ctx, origin: origin, unit: unit, shadow: false)
                }
                .frame(width: size * 1.5, height: size * 1.5)
            }
            if frame.hearing {
                // Three soft sound bars beside Pal's head, rising and falling: what you say now is heard.
                HStack(alignment: .bottom, spacing: unit) {
                    ForEach(0..<3, id: \.self) { i in
                        Capsule().fill(theme.live.color)
                            .frame(width: unit * 2, height: unit * CGFloat(2 + (Int(time * 8) + i * 2) % 5))
                    }
                }
                .frame(height: unit * 7, alignment: .bottom)
                .offset(x: size * 1.5 / 2 + sprite * 0.3, y: feetY - sprite * 0.7)
                .accessibilityLabel("Speak now")
            }
            if frame.sleeping {
                Text("z")
                    .font(.system(size: max(9, size * 0.2), weight: .heavy, design: .rounded))
                    .foregroundStyle(theme.text2.color)
                    .offset(x: size * 1.5 / 2 + sprite * 0.25, y: feetY - sprite * 0.75 - CGFloat(Int(time * 2) % 3) * unit * 2)
            }
        }
        .frame(width: size * 1.5, height: size * 1.5, alignment: .topLeading)
        .accessibilityLabel("ZENO's pet, ATOM")
    }
}
