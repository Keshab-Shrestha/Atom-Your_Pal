import SwiftUI
import ZenoIslandCore

/// Wisp, drawn in SwiftUI shapes (ADR-042): a soft glowing spirit with a wavy hem. Every motion is a pure
/// function of `time`, so one `TimelineView` drives it and the gallery can render any moment exactly.
///
/// Drawn in a 64×64 design space (the original sketch), scaled to `size`, with a margin of `size / 4` on every
/// side so the dots, z's and sound waves are never clipped. The view is therefore `size * 1.5` square.
struct WispView: View {
    /// The margin around the drawing for a given size.
    static func margin(for size: CGFloat) -> CGFloat { size / 4 }
    /// Where Wisp's feet are, as a fraction of the view's height measured from the bottom.
    static func groundInset(for size: CGFloat) -> CGFloat { size * 1.5 - (margin(for: size) + size * 61 / 64) }

    var mood: PetBrain.Mood
    /// Seconds, from any steady clock.
    var time: Double
    /// +1 facing right, -1 facing left: the eyes look the way Wisp floats.
    var facing: Double = 1
    var size: CGFloat = 64

    private static let body = Color(red: 0.79, green: 0.93, blue: 1.0)      // #c9ecff
    private static let glow = Color(red: 0.56, green: 0.83, blue: 1.0)      // #8fd3ff
    private static let ink = Color(red: 0.11, green: 0.16, blue: 0.27)      // #1b2a44
    private static let blush = Color(red: 1.0, green: 0.62, blue: 0.70)     // #ff9fb2
    private static let accent = Color(red: 0.81, green: 0.89, blue: 1.0)    // #cfe3ff
    private static let worry = Color(red: 1.0, green: 0.72, blue: 0.45)

    var body: some View {
        Canvas { context, _ in
            let scale = size / 64
            context.translateBy(x: Self.margin(for: size), y: Self.margin(for: size))
            context.scaleBy(x: scale, y: scale)
            draw(in: &context)
        }
        .frame(width: size * 1.5, height: size * 1.5)
        .accessibilityLabel("ZENO's pet, Wisp")
    }

    // MARK: - Motion (all pure functions of time)

    /// Vertical float offset in design points (negative is up).
    private var bob: Double {
        switch mood {
        case .napping, .carried: 0
        case .listening: -4 + sin(time * 2 * .pi / 0.9) * 0.6 // perked up, small hover
        case .floating: sin(time * 2 * .pi / 1.4) * 2.2
        default: sin(time * 2 * .pi / 2.2) * 1.6
        }
    }

    /// Squash for breathing while napping, a slight stretch while listening.
    private var squash: (x: Double, y: Double) {
        switch mood {
        case .napping:
            let b = (1 - cos(time * 2 * .pi / 3.2)) / 2
            return (1 + 0.03 * b, 1 - 0.06 * b)
        case .listening: return (0.98, 1.04)
        case .carried: return (0.97, 1.05)
        default: return (1, 1)
        }
    }

    /// Lean into the direction of travel.
    private var lean: Double {
        switch mood {
        case .floating: facing * 0.08
        case .carried: sin(time * 2 * .pi / 0.9) * 0.14 // dangles from the user's hand
        default: 0
        }
    }

    /// The halo's opacity: a slow pulse, faster while listening and thinking.
    private var glowOpacity: Double {
        let period: Double = switch mood {
        case .listening: 0.6
        case .carried: 0.8
        case .thinking: 1.0
        case .napping: 4.0
        default: 2.0
        }
        let pulse = (1 + cos(time * 2 * .pi / period)) / 2 // 1 → 0 → 1
        let low = mood == .napping ? 0.35 : 0.55
        return low + (0.85 - low) * pulse
    }

    private var haloScale: Double {
        switch mood {
        case .listening: 1.08 + 0.04 * sin(time * 2 * .pi / 0.6)
        case .napping: 0.96
        default: 1.0
        }
    }

    /// 1 open, 0 shut: a quick blink every ~4 s (offset so it does not feel mechanical).
    private var eyeOpen: Double {
        let phase = (time + 0.7).truncatingRemainder(dividingBy: 4.1) / 4.1
        return phase > 0.955 ? 0.12 : 1
    }

    // MARK: - Drawing

    private func draw(in context: inout GraphicsContext) {
        // Ground shadow: shrinks as Wisp rises. None while carried: there is no ground in the user's hand.
        let lift = -bob
        let shadowWidth = 28 - lift * 1.2
        if mood != .carried {
            context.fill(
                Path(ellipseIn: CGRect(x: 32 - shadowWidth / 2, y: 59, width: shadowWidth, height: 4)),
                with: .color(.black.opacity(0.22 - lift * 0.015))
            )
        }

        var figure = context
        // Carried: hangs from the top of its head (the grip point), so it swings from there.
        let pivotY = mood == .carried ? 8.0 : 57.0
        figure.translateBy(x: 32, y: pivotY + bob)
        figure.rotate(by: .radians(lean))
        figure.scaleBy(x: squash.x, y: squash.y)
        figure.translateBy(x: -32, y: -pivotY)

        // Halo.
        var halo = figure
        halo.translateBy(x: 32, y: 32)
        halo.scaleBy(x: haloScale, y: haloScale)
        halo.translateBy(x: -32, y: -32)
        halo.addFilter(.blur(radius: 2.5))
        halo.fill(Self.outer, with: .color((mood == .worried ? Self.worry : Self.glow).opacity(glowOpacity)))

        figure.fill(Self.inner, with: .color(Self.body))
        // A soft highlight, top left.
        figure.fill(
            Path(ellipseIn: CGRect(x: 18, y: 13, width: 10, height: 7)),
            with: .color(.white.opacity(0.45))
        )

        drawFace(in: &figure)
        drawExtras(in: context, bob: bob)
    }

    private func drawFace(in context: inout GraphicsContext) {
        // Eyes look a little toward the direction of travel, or up toward the thinking dots.
        let look = mood == .floating ? facing * 1.5 : (mood == .thinking ? 1.2 : 0)
        let eyes = [25.0 + look, 39.0 + look]
        let eyeY = 30.0

        switch mood {
        case .napping:
            for x in eyes { context.stroke(arc(x: x, y: 31, width: 6, dip: 2), with: .color(Self.ink), style: .init(lineWidth: 2, lineCap: .round)) }
        default:
            let height = 8 * (mood == .listening ? 1.1 : (mood == .carried ? 1.2 : 1)) * (mood == .carried ? 1 : eyeOpen)
            for x in eyes {
                context.fill(Path(ellipseIn: CGRect(x: x - 3, y: eyeY - height / 2, width: 6, height: height)), with: .color(Self.ink))
                if mood == .thinking {
                    // Looking up and right at the thinking dots: a white crescent low on the eye, so the dark part sits high.
                    context.fill(Path(ellipseIn: CGRect(x: x - 2.2, y: eyeY + height / 2 - 2.8, width: 3.2, height: 2.2)), with: .color(.white.opacity(0.85)))
                } else if eyeOpen > 0.5 { // tiny catchlight
                    context.fill(Path(ellipseIn: CGRect(x: x - 1.6, y: eyeY - height / 2 + 1.2, width: 1.8, height: 1.8)), with: .color(.white.opacity(0.9)))
                }
            }
            if mood == .worried {
                // Brows slanting up toward the middle.
                var brows = Path()
                brows.move(to: CGPoint(x: eyes[0] - 3.5, y: 23)); brows.addLine(to: CGPoint(x: eyes[0] + 2.5, y: 21))
                brows.move(to: CGPoint(x: eyes[1] + 3.5, y: 23)); brows.addLine(to: CGPoint(x: eyes[1] - 2.5, y: 21))
                context.stroke(brows, with: .color(Self.ink), style: .init(lineWidth: 1.6, lineCap: .round))
            }
        }

        // Cheeks.
        let blush = mood == .worried ? 0.3 : 0.6
        for x in [20.0, 44.0] {
            context.fill(Path(ellipseIn: CGRect(x: x - 2.5, y: 33.5, width: 5, height: 5)), with: .color(Self.blush.opacity(blush)))
        }

        // Mouth.
        let mouthX = 32 + (mood == .floating ? facing * 1.5 : 0)
        switch mood {
        case .speaking:
            // Opens and closes about 5.5 times a second.
            let open = 0.35 + 0.65 * abs(sin(time * .pi * 5.5))
            context.fill(Path(ellipseIn: CGRect(x: mouthX - 3, y: 40 - 3 * open, width: 6, height: 6 * open)), with: .color(Self.ink))
        case .listening:
            context.fill(Path(ellipseIn: CGRect(x: mouthX - 1.6, y: 38.5, width: 3.2, height: 3)), with: .color(Self.ink))
        case .carried:
            // A small surprised "o".
            context.fill(Path(ellipseIn: CGRect(x: mouthX - 2.2, y: 38.5, width: 4.4, height: 5)), with: .color(Self.ink))
        case .worried:
            context.stroke(arc(x: mouthX, y: 41, width: 6, dip: -2), with: .color(Self.ink), style: .init(lineWidth: 2, lineCap: .round))
        case .napping:
            context.fill(Path(ellipseIn: CGRect(x: mouthX - 1.2, y: 39, width: 2.4, height: 2)), with: .color(Self.ink.opacity(0.8)))
        case .thinking:
            // A small, slightly lopsided "hmm".
            var hmm = Path()
            hmm.move(to: CGPoint(x: mouthX - 2.5, y: 39.6))
            hmm.addLine(to: CGPoint(x: mouthX + 2.5, y: 40.4))
            context.stroke(hmm, with: .color(Self.ink), style: .init(lineWidth: 2, lineCap: .round))
        default:
            context.stroke(arc(x: mouthX, y: 39, width: 6, dip: 2.5), with: .color(Self.ink), style: .init(lineWidth: 2, lineCap: .round))
        }
    }

    /// Drawn outside the bobbing figure's transform so they read as floating around it.
    private func drawExtras(in context: GraphicsContext, bob: Double) {
        switch mood {
        case .napping:
            // Two z's rising and fading, staggered, with a soft glow so they read on any wallpaper.
            for delay in [0.0, 1.2] {
                let p = ((time + delay).truncatingRemainder(dividingBy: 2.4)) / 2.4
                let opacity = p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75
                let size = 8 + p * 5 // grows as it rises
                let at = CGPoint(x: 52 + p * 9, y: 10 - p * 14)
                var glow = context
                glow.addFilter(.blur(radius: 1.5))
                glow.draw(Text("z").font(.system(size: size, weight: .heavy, design: .rounded)).foregroundColor(Self.glow.opacity(opacity)), at: at)
                context.draw(Text("z").font(.system(size: size, weight: .heavy, design: .rounded)).foregroundColor(.white.opacity(opacity)), at: at)
            }
        case .thinking:
            // Three dots that light up in turn, above and to the right.
            for i in 0..<3 {
                let phase = (time - Double(i) * 0.2).truncatingRemainder(dividingBy: 1.0)
                let brightness = 0.25 + 0.75 * max(0, sin(phase * .pi))
                let r = 2.0 + Double(i) * 0.3
                context.fill(
                    Path(ellipseIn: CGRect(x: 46 + Double(i) * 6.5 - r, y: 6 - Double(i) * 2.5 + bob * 0.5 - r, width: r * 2, height: r * 2)),
                    with: .color(Self.accent.opacity(brightness))
                )
            }
        case .speaking:
            // Sound waves on the side Wisp faces.
            for (i, delay) in [0.0, 0.25].enumerated() {
                let p = ((time + 1 - delay).truncatingRemainder(dividingBy: 1.0))
                let opacity = sin(p * .pi)
                let r = Double(6 + i * 5)
                var wave = Path()
                let cx = 32 + facing * 22, cy = 40 + bob
                wave.addArc(center: CGPoint(x: cx, y: cy), radius: r, startAngle: .degrees(facing > 0 ? -40 : 140), endAngle: .degrees(facing > 0 ? 40 : 220), clockwise: false)
                context.stroke(wave, with: .color(Self.accent.opacity(opacity)), style: .init(lineWidth: 2, lineCap: .round))
            }
        case .listening:
            // Little "ears up" sparks on both sides, pulsing.
            let o = 0.5 + 0.5 * sin(time * 2 * .pi / 0.6)
            var sparks = Path()
            sparks.move(to: CGPoint(x: 13, y: 17 + bob)); sparks.addLine(to: CGPoint(x: 8, y: 12 + bob))
            sparks.move(to: CGPoint(x: 51, y: 17 + bob)); sparks.addLine(to: CGPoint(x: 56, y: 12 + bob))
            context.stroke(sparks, with: .color(Self.body.opacity(0.6 + 0.4 * o)), style: .init(lineWidth: 3, lineCap: .round))
        case .worried:
            // A small sweat drop.
            var drop = Path()
            let y = 14 + bob
            drop.move(to: CGPoint(x: 50, y: y))
            drop.addQuadCurve(to: CGPoint(x: 50, y: y + 8), control: CGPoint(x: 54, y: y + 6))
            drop.addQuadCurve(to: CGPoint(x: 50, y: y), control: CGPoint(x: 46, y: y + 6))
            context.fill(drop, with: .color(Color(red: 0.6, green: 0.85, blue: 1).opacity(0.9)))
        default:
            break
        }
    }

    // MARK: - Shapes

    /// A short curve between (x ± width/2, y); positive dip curves down (a smile or a shut eye).
    private func arc(x: Double, y: Double, width: Double, dip: Double) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: x - width / 2, y: y))
        p.addQuadCurve(to: CGPoint(x: x + width / 2, y: y), control: CGPoint(x: x, y: y + dip * 2))
        return p
    }

    /// The glow outline, from the chosen sketch.
    private static let outer: Path = {
        var p = Path()
        p.move(to: CGPoint(x: 32, y: 6))
        p.addCurve(to: CGPoint(x: 54, y: 34), control1: CGPoint(x: 48, y: 6), control2: CGPoint(x: 54, y: 20))
        p.addCurve(to: CGPoint(x: 44, y: 56), control1: CGPoint(x: 54, y: 48), control2: CGPoint(x: 48, y: 56))
        p.addCurve(to: CGPoint(x: 37, y: 52), control1: CGPoint(x: 41, y: 56), control2: CGPoint(x: 40, y: 52))
        p.addCurve(to: CGPoint(x: 32, y: 57), control1: CGPoint(x: 34, y: 52), control2: CGPoint(x: 34, y: 57))
        p.addCurve(to: CGPoint(x: 27, y: 52), control1: CGPoint(x: 30, y: 57), control2: CGPoint(x: 30, y: 52))
        p.addCurve(to: CGPoint(x: 20, y: 56), control1: CGPoint(x: 24, y: 52), control2: CGPoint(x: 23, y: 56))
        p.addCurve(to: CGPoint(x: 10, y: 34), control1: CGPoint(x: 16, y: 56), control2: CGPoint(x: 10, y: 48))
        p.addCurve(to: CGPoint(x: 32, y: 6), control1: CGPoint(x: 10, y: 20), control2: CGPoint(x: 16, y: 6))
        p.closeSubpath()
        return p
    }()

    /// The body, from the chosen sketch.
    private static let inner: Path = {
        var p = Path()
        p.move(to: CGPoint(x: 32, y: 9))
        p.addCurve(to: CGPoint(x: 51, y: 34), control1: CGPoint(x: 46, y: 9), control2: CGPoint(x: 51, y: 21))
        p.addCurve(to: CGPoint(x: 43, y: 53), control1: CGPoint(x: 51, y: 46), control2: CGPoint(x: 46, y: 53))
        p.addCurve(to: CGPoint(x: 37, y: 49), control1: CGPoint(x: 41, y: 53), control2: CGPoint(x: 40, y: 49))
        p.addCurve(to: CGPoint(x: 32, y: 54), control1: CGPoint(x: 34, y: 49), control2: CGPoint(x: 34, y: 54))
        p.addCurve(to: CGPoint(x: 27, y: 49), control1: CGPoint(x: 30, y: 54), control2: CGPoint(x: 30, y: 49))
        p.addCurve(to: CGPoint(x: 21, y: 53), control1: CGPoint(x: 24, y: 49), control2: CGPoint(x: 23, y: 53))
        p.addCurve(to: CGPoint(x: 13, y: 34), control1: CGPoint(x: 18, y: 53), control2: CGPoint(x: 13, y: 46))
        p.addCurve(to: CGPoint(x: 32, y: 9), control1: CGPoint(x: 13, y: 21), control2: CGPoint(x: 18, y: 9))
        p.closeSubpath()
        return p
    }()
}
