import SwiftUI
import ZenoIslandCore

/// Pal on screen (ADR-093): ZENO's own 2D pixel character, drawn from Pal's file (`assets/pals/pal.json`) by
/// `PixelPal`, crisp at a whole-number pixel scale. Its mood and reactions come from `PixelPalMotion`, a pure
/// function of `time`, so one clock drives it and the gallery can render any moment exactly. No glow, no leaning.
///
/// The view is `size * 1.5` square with a margin of `size / 4`, and Pal's feet sit at 61/64 of `size` below the
/// margin, as before, so walking, dragging and pointing place it the same way.
struct PalView: View {
    /// The margin around the drawing for a given size.
    static func margin(for size: CGFloat) -> CGFloat { size / 4 }
    /// Where Pal's feet are, measured from the bottom of the view.
    static func groundInset(for size: CGFloat) -> CGFloat { size * 1.5 - (margin(for: size) + size * 61 / 64) }
    /// The bottom of the feet in the 32-pixel sprite.
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
        let frame = PixelPalMotion.frame(mood: mood, time: time, gazeX: gaze.width, micLive: micLive, reaction: reaction, progress: reactionProgress)
        let pixel = max(1, (size / CGFloat(PixelPal.size)).rounded())
        let sprite = CGFloat(PixelPal.size) * pixel
        let feetY = Self.margin(for: size) + size * 61 / 64
        // Eyes are drawn in the sprite's own direction: mirrored when Pal faces left.
        let flipped = facing < 0
        ZStack(alignment: .topLeading) {
            if let pal = PalLibrary.pal, let image = PixelImages.pal("pal", pal, frame.pose, flipped ? -frame.look : frame.look) {
                Image(decorative: image, scale: 1)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: sprite, height: sprite)
                    .scaleEffect(x: (flipped ? -1 : 1) * frame.squashX * (1 + hover * 0.05), y: frame.squashY * (1 + hover * 0.05), anchor: UnitPoint(x: 0.5, y: Self.spriteFeet / CGFloat(PixelPal.size)))
                    .rotationEffect(.degrees(frame.wobble), anchor: UnitPoint(x: 0.5, y: Self.spriteFeet / CGFloat(PixelPal.size)))
                    .offset(x: (size * 1.5 - sprite) / 2, y: feetY - Self.spriteFeet * pixel + CGFloat(frame.bob) * pixel)
            }
            if frame.hearing {
                // Three pixel sound bars beside Pal's head, rising and falling: what you say now is heard.
                HStack(alignment: .bottom, spacing: pixel) {
                    ForEach(0..<3, id: \.self) { i in
                        Rectangle().fill(theme.live.color)
                            .frame(width: pixel * 2, height: pixel * CGFloat(2 + (Int(time * 8) + i * 2) % 5))
                    }
                }
                .frame(height: pixel * 7, alignment: .bottom)
                .offset(x: size * 1.5 / 2 + sprite * 0.3, y: feetY - sprite * 0.7)
                .accessibilityLabel("Speak now")
            }
            if frame.sleeping {
                Text("z")
                    .font(.system(size: max(9, size * 0.2), weight: .heavy, design: .monospaced))
                    .foregroundStyle(theme.text2.color)
                    .offset(x: size * 1.5 / 2 + sprite * 0.25, y: feetY - sprite * 0.75 - CGFloat(Int(time * 2) % 3) * pixel * 2)
            }
        }
        .frame(width: size * 1.5, height: size * 1.5, alignment: .topLeading)
        .accessibilityLabel("ZENO's pet, Pal")
    }
}
