import SwiftUI
import ZenoIslandCore

/// Wisp (ADR-042, ADR-057), drawn in one of three styles: the refined ghost, the orb of light, or the warmer
/// companion. Every motion is a pure function of `time`, so one `TimelineView` drives it and the gallery can
/// render any moment exactly. Moods are carried by the body, the light and the face — never by stickers (no
/// z's, sweat drops or cheeks).
///
/// Drawn in a 64×64 design space, scaled to `size`, with a margin of `size / 4` on every side so rings and glow
/// are never clipped. The view is therefore `size * 1.5` square. The feet (or the bottom of the orb's float) sit
/// at y = 57 in every style, so placement, hiding and pointing work the same for all of them.
struct WispView: View {
    /// The margin around the drawing for a given size.
    static func margin(for size: CGFloat) -> CGFloat { size / 4 }
    /// Where Wisp's feet are as a fraction of the view's height, from the top (the pivot for leaning).
    static let feetFraction: CGFloat = (1.0 / 4 + 61.0 / 64) / 1.5
    /// Where Wisp's feet are, as a fraction of the view's height measured from the bottom.
    static func groundInset(for size: CGFloat) -> CGFloat { size * 1.5 - (margin(for: size) + size * 61 / 64) }

    var mood: PetBrain.Mood
    /// Seconds, from any steady clock.
    var time: Double
    /// +1 facing right, -1 facing left: the eyes look the way Wisp floats.
    var facing: Double = 1
    var size: CGFloat = 64
    /// Multiplies the halo's opacity (Settings → Wisp → Glow). 1 is the original look.
    var glow: Double = 1
    /// The hiding pose (ADR-053): 0 standing, 1 hiding at the left edge, -1 at the right edge. In between while
    /// Wisp leans in. The eyes glance toward the display and a hand grips the edge.
    var hide: Double = 0
    /// Degrees Wisp is leaned (clockwise) and how far inward of its feet the display edge lies, in design points.
    var tilt: Double = 0
    var edgeGap: Double = 4.5
    /// How Wisp is drawn (Settings → Appearance → Wisp).
    var style: WispStyle = .ghost
    /// ADR-073, while ZENO is idle: where the eyes look toward the pointer (design points, y down), how much the
    /// pointer is over Wisp (0...1), and the reaction playing with how far through it is (0...1).
    var gaze = CGSize.zero
    var hover: Double = 0
    var reaction: WispReaction?
    var reactionProgress: Double = 0

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

    // MARK: - Colours

    private static func hex(_ value: UInt32, _ opacity: Double = 1) -> Color {
        Color(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255).opacity(opacity)
    }

    /// Ghost.
    private static let ghostBody = hex(0xC9ECFF)
    private static let ghostGlow = hex(0x8FD3FF)
    private static let ghostInk = hex(0x1B2A44)
    /// Orb.
    private static let orbInk = hex(0x0F1430)
    /// Companion.
    private static let mintTop = hex(0xF6FFFC)
    private static let mintBottom = hex(0xC5EBDF)
    private static let mintPool = hex(0xA6DFCF)
    private static let mintRim = hex(0x8FD2C0)
    private static let companionInk = hex(0x1E2626)

    /// Shared mood light: listening teal, thinking violet, a problem amber.
    private static let listenLight = hex(0x6FE7FF)
    private static let thinkLight = hex(0xB69CFF)
    private static let worryLight = hex(0xFFB86B)

    private var ink: Color {
        switch style {
        case .ghost: Self.ghostInk
        case .orb: Self.orbInk
        case .companion: Self.companionInk
        }
    }

    /// The body colour used for the hand on the display edge.
    private var handFill: Color {
        switch style {
        case .ghost: Self.ghostBody
        case .orb: Self.hex(0xC9D2FF)
        case .companion: Self.hex(0xE4F6F0)
        }
    }
    private var handLine: Color {
        switch style {
        case .ghost: Self.ghostGlow.opacity(0.75)
        case .orb: .white.opacity(0.8)
        case .companion: Self.mintRim.opacity(0.9)
        }
    }

    // MARK: - Motion (all pure functions of time)

    /// Vertical float offset in design points (negative is up).
    private var bob: Double {
        let base: Double = switch mood {
        case .napping, .carried: 0
        case .listening: -4 + sin(time * 2 * .pi / 0.9) * 0.6 // perked up, small hover
        case .floating: -4 + sin(time * 2 * .pi / 1.4) * 2.2 // clearly aloft: higher than resting, smaller shadow
        case .speaking: -abs(sin(time * .pi * 2.75)) * 1.2 // a small bounce with the syllables
        default: sin(time * 2 * .pi / 2.2) * 1.6
        }
        // A problem makes Wisp sink a little; hello is a small hop.
        return base + (mood == .worried ? 2.5 : 0) - (reaction == .hello ? 6 * beat : 0)
    }

    /// 0 → 1 → 0 over the reaction playing now.
    private var beat: Double { reaction == nil ? 0 : sin(reactionProgress * .pi) }

    /// A click's squash-and-stretch, and hello's stretch on the way up. The orb only half as much: it should
    /// still read as a sphere.
    private var reactionSquash: (x: Double, y: Double) {
        let amount = style == .orb ? 0.5 : 1
        switch reaction {
        case .squish:
            let wave = sin(reactionProgress * 2 * .pi) * (1 - reactionProgress) * 0.16 * amount
            return (1 + wave, 1 - wave)
        case .hello: return (1 - 0.05 * beat * amount, 1 + 0.07 * beat * amount)
        default: return (1, 1)
        }
    }

    /// Squash for breathing while napping, a slight stretch while listening, jelly while carried.
    private var squash: (x: Double, y: Double) {
        switch mood {
        case .napping:
            let b = (1 - cos(time * 2 * .pi / (style == .companion ? 5.5 : 4))) / 2
            return style == .companion ? (1.06 + 0.02 * b, 0.9 - 0.03 * b) : (1 + 0.03 * b, 1 - 0.06 * b)
        case .listening: return (0.98, 1.04)
        // Carried: the ghost and companion stretch as they dangle; the orb stays round (a stretched sphere reads
        // as a scaling bug) and shows it through the sway, the missing shadow and its surprised face.
        case .carried: return style == .orb ? (1, 1) : (0.94, 1.08)
        case .worried: return style == .companion ? (0.92, 0.92) : (1, 1)
        case .resting where style == .companion:
            let b = (1 - cos(time * 2 * .pi / 4)) / 2
            return (1, 1 + 0.025 * b)
        default: return (1, 1)
        }
    }

    /// Lean into the direction of travel; a head tilt while thinking; a wobble while dizzy.
    private var lean: Double {
        if reaction == .dizzy { return sin(time * 2 * .pi * 2.5) * 0.12 * (1 - reactionProgress) }
        return switch mood {
        case .floating: facing * 0.08
        case .carried: sin(time * 2 * .pi / 0.9) * 0.14 // dangles from the user's hand
        case .thinking: style == .orb ? 0 : 0.11
        case .listening: style == .companion ? facing * 0.07 : 0
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
        let low = mood == .napping ? 0.25 : 0.55
        return (low + (0.85 - low) * pulse) * (1 + 0.35 * hover)
    }

    private var haloScale: Double {
        switch mood {
        case .listening: 1.08 + 0.04 * sin(time * 2 * .pi / 0.6)
        case .napping: 0.94
        default: 1.0
        }
    }

    /// The halo's colour follows the mood in every style.
    private var haloColor: Color {
        switch mood {
        case .worried: Self.worryLight
        case .listening: Self.listenLight
        case .thinking: Self.thinkLight
        default:
            switch style {
            case .ghost: Self.ghostGlow
            case .orb: Self.hex(0x7F9BFF)
            case .companion: Self.hex(0x8FE3CF)
            }
        }
    }

    /// 1 open, 0 shut: a quick blink every ~4 s (offset so it does not feel mechanical).
    private var eyeOpen: Double {
        let phase = (time + 0.7).truncatingRemainder(dividingBy: 4.1) / 4.1
        return phase > 0.955 ? 0.12 : 1
    }

    // MARK: - Hiding pose

    private var hideAmount: Double { min(1, abs(hide)) }
    /// +1 when the display is to Wisp's right (hiding at the left edge), -1 at the right edge.
    private var hideSide: Double { hide < 0 ? -1 : 1 }

    /// A little hand that holds on to the display's edge: its fingers lie over the edge into the display, one
    /// above the other, while the arm and the rest of Wisp stay behind it. Drawn upright (against the lean) so the
    /// fingers stay level with the edge however far Wisp tips.
    private func drawEdgeHand(in context: inout GraphicsContext, bob: Double) {
        guard hideAmount > 0.05 else { return }
        var hand = context
        // Undo the lean around the feet, so the hand lies in screen space.
        hand.translateBy(x: 32, y: 57)
        hand.rotate(by: .radians(-tilt * .pi / 180))
        hand.translateBy(x: -32, y: -57)
        // The edge is a vertical line `edgeGap` design points inward of the feet. Drawn for the left edge, mirrored
        // for the right.
        let edge = 32 + edgeGap
        if hideSide < 0 {
            hand.translateBy(x: 64, y: 0)
            hand.scaleBy(x: -1, y: 1)
        }
        let a = hideAmount
        hand.opacity = a
        let x = edge // after mirroring, "into the display" is +x at both edges
        let top = 45.0 + bob * 0.3
        // Arm, behind the edge (the display edge hides most of it), then three fingers lying over the edge.
        hand.fill(Path(roundedRect: CGRect(x: x - 9, y: top, width: 10, height: 10.4), cornerRadius: 4), with: .color(handFill))
        for i in 0..<3 {
            let y = top + Double(i) * 3.6
            let finger = CGRect(x: x - 2, y: y, width: 9 - Double(i == 1 ? 0 : 1), height: 3.4)
            hand.fill(Path(roundedRect: finger, cornerRadius: 1.7), with: .color(handFill))
            hand.stroke(Path(roundedRect: finger, cornerRadius: 1.7), with: .color(handLine), lineWidth: 0.7)
        }
    }

    // MARK: - Drawing

    private func draw(in context: inout GraphicsContext) {
        // Ground shadow (a coloured floor glow for the orb): shrinks as Wisp rises. None while carried or hiding.
        let lift = -bob
        let shadowWidth = 28 - lift * 1.2
        if mood != .carried, hideAmount < 0.5 {
            let floor = CGRect(x: 32 - shadowWidth / 2, y: 59, width: shadowWidth, height: 4)
            if style == .orb {
                var glowFloor = context
                glowFloor.addFilter(.blur(radius: 2))
                glowFloor.fill(Path(ellipseIn: floor), with: .color(haloColor.opacity((mood == .napping ? 0.25 : 0.45) * min(1, glow))))
            } else {
                context.fill(Path(ellipseIn: floor), with: .color(.black.opacity(0.22 - lift * 0.015)))
            }
        }

        var figure = context
        // Carried: hangs from the top of its head (the grip point), so it swings from there.
        let pivotY = mood == .carried ? 8.0 : 57.0
        figure.translateBy(x: 32, y: pivotY + bob)
        figure.rotate(by: .radians(lean))
        figure.scaleBy(x: squash.x * reactionSquash.x, y: squash.y * reactionSquash.y)
        figure.translateBy(x: -32, y: -pivotY)

        switch style {
        case .ghost: drawGhost(in: &figure)
        case .orb: drawOrb(in: &figure, base: context, bob: bob)
        case .companion: drawCompanion(in: &figure)
        }
        drawEdgeHand(in: &context, bob: bob)
        drawExtras(in: context, bob: bob)
    }

    /// The halo: a blurred, scaled copy of `shape` in the mood's light.
    private func drawHalo(_ shape: Path, in figure: GraphicsContext, centre: CGPoint, strength: Double = 1) {
        var halo = figure
        halo.translateBy(x: centre.x, y: centre.y)
        halo.scaleBy(x: haloScale, y: haloScale)
        halo.translateBy(x: -centre.x, y: -centre.y)
        halo.addFilter(.blur(radius: 2.5))
        halo.fill(shape, with: .color(haloColor.opacity(min(1, glowOpacity * glow * strength))))
    }

    // MARK: Ghost

    private func drawGhost(in figure: inout GraphicsContext) {
        drawHalo(Self.outer, in: figure, centre: CGPoint(x: 32, y: 32))
        figure.fill(Self.inner, with: .color(Self.ghostBody.opacity(mood == .napping ? 0.85 : 1)))
        // Volume: a cool shade pooled low, and a soft highlight top left.
        var shade = figure
        shade.clip(to: Self.inner)
        shade.fill(Self.inner, with: .radialGradient(
            Gradient(colors: [Self.hex(0x8FB8E8, 0.45), .clear]), center: CGPoint(x: 32, y: 56), startRadius: 0, endRadius: 26))
        figure.fill(Path(ellipseIn: CGRect(x: 18, y: 13, width: 10, height: 7)), with: .color(.white.opacity(0.5)))
        drawClassicFace(in: &figure, eyeY: 30, eyeGap: 7, mouthY: 39, scale: 1)
    }

    /// The ghost's and companion's face: eyes, optional brows, and a mouth, all varying by mood.
    private func drawClassicFace(in context: inout GraphicsContext, eyeY: Double, eyeGap: Double, mouthY: Double, scale s: Double) {
        let ink = self.ink
        // Eyes look toward the direction of travel, up while thinking, and toward the display while hiding.
        let lookX = (mood == .floating ? facing * 1.5 : (mood == .thinking ? 1.2 : 0)) * s + hideSide * hideAmount * 2.6 * s + gaze.width * s
        let lookY = (mood == .thinking ? -1.4 * s : 0) + gaze.height * s
        let eyes = [32 - eyeGap + lookX, 32 + eyeGap + lookX]
        let w = 6 * s

        switch mood {
        case _ where reaction == .dizzy:
            for x in eyes { context.stroke(spiral(x: x, y: eyeY + lookY, radius: 3.4 * s, turn: time * 9), with: .color(ink), style: .init(lineWidth: 1.4 * s, lineCap: .round)) }
        case _ where reaction == .hello:
            for x in eyes { context.stroke(arc(x: x, y: eyeY + lookY + 1 * s, width: w, dip: -2 * s), with: .color(ink), style: .init(lineWidth: 2 * s, lineCap: .round)) }
        case .napping:
            for x in eyes { context.stroke(arc(x: x, y: eyeY + 1 * s, width: w, dip: 2 * s), with: .color(ink), style: .init(lineWidth: 2 * s, lineCap: .round)) }
        default:
            let wide = mood == .listening || mood == .carried
            let height = 8 * s * (wide ? 1.15 : (mood == .worried ? 0.9 : 1)) * (mood == .carried ? 1 : eyeOpen) * (1 + 0.12 * hover)
            let width = w * (wide ? 1.1 : 1)
            for x in eyes {
                context.fill(Path(ellipseIn: CGRect(x: x - width / 2, y: eyeY + lookY - height / 2, width: width, height: height)), with: .color(ink))
                if eyeOpen > 0.5 || mood == .carried { // one catchlight, top right
                    context.fill(Path(ellipseIn: CGRect(x: x + 0.1 * s, y: eyeY + lookY - height / 2 + 1.1 * s, width: 1.9 * s, height: 1.9 * s)),
                                 with: .color(.white.opacity(0.92)))
                }
            }
            if mood == .worried {
                // Brows slanting up toward the middle.
                var brows = Path()
                brows.move(to: CGPoint(x: eyes[0] - 3.5 * s, y: eyeY - 7 * s)); brows.addLine(to: CGPoint(x: eyes[0] + 2.5 * s, y: eyeY - 9 * s))
                brows.move(to: CGPoint(x: eyes[1] + 3.5 * s, y: eyeY - 7 * s)); brows.addLine(to: CGPoint(x: eyes[1] - 2.5 * s, y: eyeY - 9 * s))
                context.stroke(brows, with: .color(ink), style: .init(lineWidth: 1.6 * s, lineCap: .round))
            }
        }

        let mouthX = 32 + (mood == .floating ? facing * 1.5 * s : 0) + hideSide * hideAmount * 2.2 * s + gaze.width * 0.6 * s
        switch mood {
        case _ where reaction == .yawn:
            let open = 0.3 + 0.7 * beat
            context.fill(Path(ellipseIn: CGRect(x: mouthX - 2.4 * s, y: mouthY - 1 * s, width: 4.8 * s, height: 6.5 * s * open)), with: .color(ink))
        case .speaking:
            // Opens and closes about 5.5 times a second.
            let open = 0.5 + 0.5 * abs(sin(time * .pi * 5.5))
            let mouth = CGRect(x: mouthX - 3 * s, y: mouthY + 1 * s - 3 * s * open, width: 6 * s, height: 6 * s * open)
            context.fill(Path(roundedRect: mouth, cornerRadius: 2.6 * s * open), with: .color(ink))
            if style == .companion, open > 0.55 {
                context.fill(Path(ellipseIn: CGRect(x: mouthX - 1.8 * s, y: mouth.maxY - 2.2 * s, width: 3.6 * s, height: 1.8 * s)),
                             with: .color(Self.hex(0xE05A50)))
            }
        case .listening, .carried:
            let r = (mood == .carried ? 2.3 : 1.7) * s
            context.fill(Path(ellipseIn: CGRect(x: mouthX - r, y: mouthY - 0.5 * s, width: r * 2, height: r * 2.1)), with: .color(ink))
        case .worried:
            context.stroke(arc(x: mouthX, y: mouthY + 2 * s, width: w, dip: -1.8 * s), with: .color(ink), style: .init(lineWidth: 2 * s, lineCap: .round))
        case .napping:
            var line = Path()
            line.move(to: CGPoint(x: mouthX - 1.4 * s, y: mouthY + 0.6 * s)); line.addLine(to: CGPoint(x: mouthX + 1.4 * s, y: mouthY + 0.6 * s))
            context.stroke(line, with: .color(ink.opacity(0.75)), style: .init(lineWidth: 1.6 * s, lineCap: .round))
        case .thinking:
            // A small, slightly lopsided "hmm", offset toward where the eyes look.
            var hmm = Path()
            hmm.move(to: CGPoint(x: mouthX - 1.5 * s, y: mouthY + 0.6 * s))
            hmm.addLine(to: CGPoint(x: mouthX + 3 * s, y: mouthY + 1.2 * s))
            context.stroke(hmm, with: .color(ink), style: .init(lineWidth: 2 * s, lineCap: .round))
        default:
            context.stroke(arc(x: mouthX, y: mouthY, width: w, dip: 2.5 * s), with: .color(ink), style: .init(lineWidth: 2 * s, lineCap: .round))
        }
    }

    // MARK: Orb

    private static let orbCentre = CGPoint(x: 32, y: 36)
    private static let orbRadius = 18.5

    /// The orb's light, centre → middle → rim, by mood.
    private var orbColors: [Color] {
        switch mood {
        case .worried: [Self.hex(0xF8C79A), Self.hex(0xEC9160), Self.hex(0xD4605C)]
        case .napping: [Self.hex(0x7E9CC0), Self.hex(0x6F7FB0), Self.hex(0x5A4C98)]
        case .listening: [Self.hex(0xD2F4FF), Self.hex(0x86B4FF), Self.hex(0x6A4EE0)]
        default: [Self.hex(0xBFE6FF), Self.hex(0x8FA8FF), Self.hex(0x6A4EE0)]
        }
    }

    /// The orb's outline: a circle, rippling with the voice while listening.
    private var orbShape: Path {
        let c = Self.orbCentre, r = Self.orbRadius
        // Listening: the circle swells gently with the voice; the rings around it carry the meaning.
        let rr = mood == .listening ? r * (1.02 + 0.025 * sin(time * 2 * .pi / 0.5)) : r
        return Path(ellipseIn: CGRect(x: c.x - rr, y: c.y - rr, width: rr * 2, height: rr * 2))
    }

    private func drawOrb(in figure: inout GraphicsContext, base: GraphicsContext, bob: Double) {
        let c = Self.orbCentre, r = Self.orbRadius
        let shape = orbShape
        let dim = mood == .napping ? 0.8 : 1

        // A wide soft halo, then the body.
        var halo = figure
        halo.addFilter(.blur(radius: 5))
        let hr = r * 1.45 * haloScale
        halo.fill(Path(ellipseIn: CGRect(x: c.x - hr, y: c.y - hr, width: hr * 2, height: hr * 2)),
                  with: .color(haloColor.opacity(min(1, glowOpacity * glow * 0.55))))

        var body = figure
        body.opacity = dim
        body.fill(shape, with: .radialGradient(Gradient(colors: orbColors), center: CGPoint(x: c.x - 6, y: c.y - 7), startRadius: 0, endRadius: r * 1.55))

        // Thinking: an aurora turns slowly inside.
        if mood == .thinking {
            var aurora = body
            aurora.clip(to: shape)
            aurora.addFilter(.blur(radius: 3))
            aurora.opacity = 0.75
            let turn = Angle(radians: time * 0.9)
            aurora.fill(shape, with: .conicGradient(
                Gradient(colors: [Self.hex(0xFF8AD8), Self.hex(0x7A5CF0), Self.hex(0x5EF0D0), Self.hex(0x8FA8FF), Self.hex(0xFF8AD8)]),
                center: c, angle: turn))
        }

        // Gloss and rim: reads as lit glass.
        var gloss = body
        gloss.addFilter(.blur(radius: 1.2))
        gloss.translateBy(x: c.x - 7, y: c.y - 9)
        gloss.rotate(by: .degrees(-30))
        gloss.fill(Path(ellipseIn: CGRect(x: -5.5, y: -3, width: 11, height: 6)), with: .color(.white.opacity(mood == .napping ? 0.3 : 0.7)))
        body.stroke(shape, with: .color(Self.hex(mood == .worried ? 0xFFD9C4 : 0xDFE8FF, 0.5)), lineWidth: 0.8)

        drawOrbFace(in: &body)
    }

    private func drawOrbFace(in context: inout GraphicsContext) {
        let c = Self.orbCentre
        let ink = Self.orbInk
        let lookX = (mood == .floating ? facing * 2.5 : 0) + hideSide * hideAmount * 3.5 + gaze.width
        let lookY: Double = (mood == .thinking ? -3.5 : (hideAmount > 0.05 ? 1.5 : 0)) + gaze.height
        let eyes = [c.x - 6 + lookX, c.x + 6 + lookX]
        let y = c.y - 2 + lookY

        switch mood {
        case _ where reaction == .dizzy:
            for x in eyes { context.stroke(spiral(x: x, y: y, radius: 2.8, turn: time * 9), with: .color(ink), style: .init(lineWidth: 1.2, lineCap: .round)) }
        case _ where reaction == .hello:
            for x in eyes { context.stroke(arc(x: x, y: y + 0.8, width: 4.6, dip: -1.6), with: .color(ink), style: .init(lineWidth: 1.6, lineCap: .round)) }
        case _ where reaction == .yawn:
            for x in eyes { context.stroke(arc(x: x, y: y + 0.5, width: 5.2, dip: 1.8), with: .color(ink.opacity(0.85)), style: .init(lineWidth: 1.8, lineCap: .round)) }
            let open = 0.3 + 0.7 * beat
            context.fill(Path(ellipseIn: CGRect(x: c.x + lookX - 2.2, y: y + 4, width: 4.4, height: 5.5 * open)), with: .color(ink))
        case .speaking:
            // Open eyes and a small mouth that opens with the syllables.
            for x in eyes {
                context.fill(Path(ellipseIn: CGRect(x: x - 2.1, y: y - 3.1, width: 4.2, height: 6.2)), with: .color(ink))
                context.fill(Path(ellipseIn: CGRect(x: x - 1.5, y: y - 2.3, width: 1.5, height: 1.5)), with: .color(.white.opacity(0.9)))
            }
            let open = 0.5 + 0.5 * abs(sin(time * .pi * 5.5))
            let mouth = CGRect(x: c.x + lookX - 2.6, y: y + 6 - 2.4 * open, width: 5.2, height: 4.8 * open)
            context.fill(Path(roundedRect: mouth, cornerRadius: 2.2 * open), with: .color(ink))
        case .napping:
            for x in eyes { context.stroke(arc(x: x, y: y + 0.5, width: 5.2, dip: 1.8), with: .color(ink.opacity(0.85)), style: .init(lineWidth: 1.8, lineCap: .round)) }
        default:
            let wide = mood == .listening || mood == .carried
            let h = 6.2 * (wide ? 1.15 : 1) * (mood == .carried ? 1 : eyeOpen) * (1 + 0.12 * hover)
            let w = 4.2 * (wide ? 1.08 : 1)
            for x in eyes {
                context.fill(Path(ellipseIn: CGRect(x: x - w / 2, y: y - h / 2, width: w, height: h)), with: .color(ink))
                if h > 3 {
                    context.fill(Path(ellipseIn: CGRect(x: x - w / 2 + 0.6, y: y - h / 2 + 0.8, width: 1.5, height: 1.5)), with: .color(.white.opacity(0.9)))
                }
            }
            if mood == .worried {
                var brows = Path()
                brows.move(to: CGPoint(x: eyes[0] - 3, y: y - 5.5)); brows.addQuadCurve(to: CGPoint(x: eyes[0] + 2.4, y: y - 7.3), control: CGPoint(x: eyes[0], y: y - 7))
                brows.move(to: CGPoint(x: eyes[1] + 3, y: y - 5.5)); brows.addQuadCurve(to: CGPoint(x: eyes[1] - 2.4, y: y - 7.3), control: CGPoint(x: eyes[1], y: y - 7))
                context.stroke(brows, with: .color(Self.hex(0x3A1A1A)), style: .init(lineWidth: 1.4, lineCap: .round))
            }
        }
    }

    // MARK: Companion

    /// The companion's pear-shaped body with two soft hem points, from the design board (a 100×124 sketch, fitted
    /// to y 8...57 here).
    private static let pear: Path = {
        let s = 49.0 / 117.0
        func p(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: 32 + (x - 50) * s, y: 8 + (y - 4) * s) }
        var path = Path()
        path.move(to: p(50, 4))
        path.addCurve(to: p(20, 42), control1: p(31, 4), control2: p(21, 21))
        path.addCurve(to: p(8, 96), control1: p(19, 60), control2: p(9, 78))
        path.addCurve(to: p(22, 121), control1: p(7, 110), control2: p(14, 121))
        path.addCurve(to: p(50, 108), control1: p(30, 121), control2: p(38, 110))
        path.addCurve(to: p(78, 121), control1: p(62, 110), control2: p(70, 121))
        path.addCurve(to: p(92, 96), control1: p(86, 121), control2: p(93, 110))
        path.addCurve(to: p(80, 42), control1: p(91, 78), control2: p(81, 60))
        path.addCurve(to: p(50, 4), control1: p(79, 21), control2: p(69, 4))
        path.closeSubpath()
        return path
    }()

    private func drawCompanion(in figure: inout GraphicsContext) {
        // A faint mint glow so it reads on dark wallpapers; the mood's light when it means something.
        let strength: Double = switch mood {
        case .listening, .worried, .thinking: 1
        case .speaking: 0.6
        case .napping: 0.25
        default: 0.4
        }
        drawHalo(Self.pear, in: figure, centre: CGPoint(x: 32, y: 34), strength: strength)

        figure.fill(Self.pear, with: .linearGradient(Gradient(colors: [Self.mintTop, Self.mintBottom]), startPoint: CGPoint(x: 32, y: 8), endPoint: CGPoint(x: 32, y: 57)))
        var shade = figure
        shade.clip(to: Self.pear)
        // Inner shade pooled at the hem gives it volume; a rim light crescent top left.
        shade.fill(Self.pear, with: .radialGradient(Gradient(colors: [Self.mintPool.opacity(0.9), .clear]), center: CGPoint(x: 32, y: 56), startRadius: 0, endRadius: 22))
        var rim = shade
        rim.addFilter(.blur(radius: 0.8))
        var crescent = Path()
        crescent.addArc(center: CGPoint(x: 32, y: 26), radius: 15.5, startAngle: .degrees(195), endAngle: .degrees(255), clockwise: false)
        rim.stroke(crescent, with: .color(.white.opacity(0.85)), style: .init(lineWidth: 2, lineCap: .round))
        figure.stroke(Self.pear, with: .color(Self.mintRim.opacity(0.45)), lineWidth: 0.7)

        drawClassicFace(in: &figure, eyeY: 26, eyeGap: 5, mouthY: 32.5, scale: 0.78)
    }

    // MARK: - Mood extras (motion around the body, never symbols)

    /// Drawn outside the bobbing figure's transform so they read as moving around it.
    private func drawExtras(in context: GraphicsContext, bob: Double) {
        let light = haloColor
        switch (style, mood) {
        case (.orb, .listening):
            // Ripples leaving the surface with the voice.
            for i in 0..<2 {
                let p = (time * 1.4 + Double(i) * 0.5).truncatingRemainder(dividingBy: 1)
                let r = Self.orbRadius * (1.12 + p * 0.45)
                let c = CGPoint(x: Self.orbCentre.x, y: Self.orbCentre.y + bob)
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                               with: .color(Self.hex(0x9DB6FF, 0.5 * (1 - p))), lineWidth: 1.1)
            }
        case (.orb, .speaking):
            // A ring on each syllable, growing and fading.
            for i in 0..<2 {
                let p = (time / 0.36 + Double(i) * 0.5).truncatingRemainder(dividingBy: 1)
                let r = Self.orbRadius * (1.08 + p * 0.35)
                let c = CGPoint(x: Self.orbCentre.x, y: Self.orbCentre.y + bob)
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                               with: .color(Self.hex(0xA8C0FF, 0.7 * (1 - p))), lineWidth: 1.6 - p)
            }
        case (.orb, .thinking):
            // A dotted orbit turning slowly, with one bright spark on it.
            let c = CGPoint(x: Self.orbCentre.x, y: Self.orbCentre.y + bob)
            let r = Self.orbRadius * 1.2
            let turn = time * 0.8
            for i in 0..<24 {
                let a = Double(i) / 24 * 2 * .pi + turn
                context.fill(Path(ellipseIn: CGRect(x: c.x + cos(a) * r - 0.45, y: c.y + sin(a) * r * 0.42 - 0.45, width: 0.9, height: 0.9)),
                             with: .color(Self.hex(0xC8D0FF, 0.5)))
            }
            let a = turn * 1.6
            let spark = CGPoint(x: c.x + cos(a) * r, y: c.y + sin(a) * r * 0.42)
            var glowSpark = context
            glowSpark.addFilter(.blur(radius: 1.4))
            glowSpark.fill(Path(ellipseIn: CGRect(x: spark.x - 2.4, y: spark.y - 2.4, width: 4.8, height: 4.8)), with: .color(Self.hex(0x5EF0D0, 0.8)))
            context.fill(Path(ellipseIn: CGRect(x: spark.x - 1.1, y: spark.y - 1.1, width: 2.2, height: 2.2)), with: .color(Self.hex(0xE8FFF8)))
        case (.orb, .floating):
            // A short light trail behind.
            for i in 1...3 {
                let d = Double(i)
                let x = Self.orbCentre.x - facing * (Self.orbRadius + 2 + d * 4.5)
                let y = Self.orbCentre.y + bob + sin(time * 4 + d) * 1.2 + d * 0.8
                let r = 2.2 - d * 0.5
                context.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)), with: .color(Self.hex(0x9DB6FF, 0.65 - d * 0.17)))
            }
        case (_, .thinking):
            // Three dots that light up in turn, above and to the right.
            for i in 0..<3 {
                let phase = (time - Double(i) * 0.2).truncatingRemainder(dividingBy: 1.0)
                let brightness = 0.25 + 0.75 * max(0, sin(phase * .pi))
                let r = 1.8 + Double(i) * 0.3
                context.fill(
                    Path(ellipseIn: CGRect(x: 46 + Double(i) * 6 - r, y: 7 - Double(i) * 2.5 + bob * 0.5 - r, width: r * 2, height: r * 2)),
                    with: .color(light.opacity(brightness)))
            }
        case (_, .speaking):
            // Sound waves on the side Wisp faces.
            for (i, delay) in [0.0, 0.25].enumerated() {
                let p = ((time + 1 - delay).truncatingRemainder(dividingBy: 1.0))
                let opacity = sin(p * .pi)
                let r = Double(6 + i * 5)
                var wave = Path()
                let cx = 32 + facing * 22, cy = (style == .companion ? 36 : 40) + bob
                wave.addArc(center: CGPoint(x: cx, y: cy), radius: r, startAngle: .degrees(facing > 0 ? -40 : 140), endAngle: .degrees(facing > 0 ? 40 : 220), clockwise: false)
                context.stroke(wave, with: .color(light.opacity(opacity * 0.9)), style: .init(lineWidth: 1.8, lineCap: .round))
            }
        case (.companion, .listening):
            // A small level meter across the body, tallest in the middle.
            for i in 0..<7 {
                let mid = 1 - abs(Double(i) - 3) / 4
                let h = 2 + 6 * mid * (0.55 + 0.45 * abs(sin(time * 6 + Double(i) * 0.9)))
                let x = 32 - 7.5 + Double(i) * 2.5
                context.fill(Path(roundedRect: CGRect(x: x - 0.7, y: 46 + bob - h / 2, width: 1.4, height: h), cornerRadius: 0.7),
                             with: .color(Self.hex(0x0B8F7E, 0.85)))
            }
        default:
            break
        }
    }

    // MARK: - Shapes

    /// A small spiral turning with `turn` (radians): dizzy eyes.
    private func spiral(x: Double, y: Double, radius: Double, turn: Double) -> Path {
        var p = Path()
        let steps = 28
        for i in 0...steps {
            let t = Double(i) / Double(steps)
            let a = turn + t * 2.6 * .pi
            let point = CGPoint(x: x + cos(a) * radius * t, y: y + sin(a) * radius * t)
            if i == 0 { p.move(to: point) } else { p.addLine(to: point) }
        }
        return p
    }

    /// A short curve between (x ± width/2, y); positive dip curves down (a smile or a shut eye).
    private func arc(x: Double, y: Double, width: Double, dip: Double) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: x - width / 2, y: y))
        p.addQuadCurve(to: CGPoint(x: x + width / 2, y: y), control: CGPoint(x: x, y: y + dip * 2))
        return p
    }

    /// The ghost's glow outline, from the chosen sketch.
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

    /// The ghost's body, from the chosen sketch.
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
