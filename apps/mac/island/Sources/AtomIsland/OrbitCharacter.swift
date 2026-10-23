import SwiftUI
import AtomIslandCore

/// ATOM's original Orbit character: a ceramic shell, inset visor and a single signal light.
/// Shared geometry keeps the app icon, portraits, desktop companion and floor actors consistent.
enum OrbitCharacter {
    private static func color(_ c: PalRGB) -> Color { Color(red: c.r, green: c.g, blue: c.b) }
    private static func box(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ r: Double) -> Path {
        Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: r, style: .continuous)
    }

    static func draw(body: PalRGB, accent: PalRGB, pose: PalStance.Pose, look: Double, opening: Double = 1,
                     in context: GraphicsContext, origin: CGPoint, unit: CGFloat, shadow: Bool) {
        var g = context
        g.translateBy(x: origin.x, y: origin.y)
        g.scaleBy(x: unit, y: unit)
        let paper = PalRGB(r: 1, g: 1, b: 1), ink = PalRGB(r: 0.055, g: 0.095, b: 0.12)
        let shell = body.mix(paper, 0.18), light = accent.mix(paper, 0.48)
        let dy = PalStance.lift(pose)
        if shadow {
            g.fill(Path(ellipseIn: CGRect(x: 6, y: 27.5, width: 20, height: 3)), with: .color(.black.opacity(0.12)))
        }
        // Short boots stay on the same ground anchor as the earlier character family.
        for (x, raised) in [(10.0, pose == .walkA), (18.0, pose == .walkB)] {
            g.fill(box(x, 25 + (raised ? -1 : 0), 5, 3.5, 1.5), with: .color(color(body.mix(ink, 0.24))))
        }
        var moving = g
        moving.translateBy(x: 0, y: dy)
        for side in [-1.0, 1.0] {
            let x = side < 0 ? 3.0 : 25.0
            let y = pose == .cheer ? 11.0 : 18.0 + (pose == .typeA && side < 0 || pose == .typeB && side > 0 ? -1 : 0)
            moving.fill(box(x, y, 4, 7, 2), with: .color(color(body.mix(ink, 0.08))))
            moving.fill(box(x + 0.6, y + 0.6, 2.8, 1.1, 0.5), with: .color(.white.opacity(0.7)))
        }
        // Antenna and collar are functional-looking parts, rather than ears or horns.
        moving.fill(box(15.2, 4.5, 1.6, 4, 0.8), with: .color(color(body.mix(ink, 0.25))))
        moving.fill(Path(ellipseIn: CGRect(x: 13.7, y: 3, width: 4.6, height: 3.7)), with: .color(color(light)))
        let head = box(6.5, 8, 19, 18, 6.5)
        moving.fill(head, with: .linearGradient(Gradient(colors: [color(shell.mix(paper, 0.6)), color(shell), color(shell.mix(ink, 0.12))]),
                                               startPoint: CGPoint(x: 10, y: 8), endPoint: CGPoint(x: 24, y: 27)))
        moving.stroke(head, with: .color(color(body.mix(ink, 0.28))), lineWidth: 0.65)
        moving.stroke(box(7.3, 8.7, 17.4, 16.5, 5.8), with: .color(.white.opacity(0.65)), lineWidth: 0.45)
        let visor = box(8.6, 12, 14.8, 9.3, 3.8)
        moving.fill(visor, with: .linearGradient(Gradient(colors: [Color(red: 0.12, green: 0.19, blue: 0.23), color(ink)]),
                                                startPoint: CGPoint(x: 16, y: 12), endPoint: CGPoint(x: 16, y: 22)))
        moving.stroke(visor, with: .color(.white.opacity(0.26)), lineWidth: 0.45)
        moving.fill(box(10, 12.8, 10, 0.7, 0.35), with: .color(.white.opacity(0.13)))
        let shift = max(-1, min(1, look)) * 1.1
        let eyeHeight = pose == .blink ? 0.65 : pose == .sad ? 1.8 : 3.2 * opening
        for x in [11.5, 18.1] {
            let eye = box(x + shift, 16.4 - eyeHeight / 2, 2.4, eyeHeight, min(1.2, eyeHeight / 2))
            moving.fill(eye, with: .color(color(light)))
            if pose == .cheer {
                moving.fill(box(x + shift - 0.4, 17.2, 3.2, 0.7, 0.35), with: .color(color(ink)))
            }
        }
        moving.fill(box(13.8, 23.1, 4.4, 1, 0.5), with: .color(color(accent.mix(paper, 0.25))))
    }
}
