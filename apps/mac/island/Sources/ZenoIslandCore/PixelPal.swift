import Foundation

/// ADR-090: a pal in 2D pixel art for the office floor, rasterised from its own avatar definition: the body, the ears
/// or antenna on its head, its arms and feet where its file puts them, in its colours, with a dark outline and simple
/// light from the top left. A few poses make its animations (idle, typing, walking, cheering, sad). Pure.
public enum PixelPal {
    public static let size = 32
    /// Where the body's centre sits in the sprite.
    public static let centre = (x: 16.0, y: 18.0)
    /// The body's width in pixels; everything else scales with it.
    static let bodyWidth = 16.0

    public enum Pose: String, CaseIterable, Sendable {
        case idle, bob, blink, typeA, typeB, walkA, walkB, cheer, sad
    }

    /// One frame. `look` moves the eyes a pixel left (-1) or right (1).
    public static func sprite(_ pal: PalDefinition, pose: Pose, look: Int = 0) -> PixelCanvas {
        let body = PixelColor(css: pal.colors.body ?? "") ?? PixelColor(hex: 0xF2F2F2)
        let eyes = PixelColor(css: pal.colors.eyes ?? "") ?? PixelColor(hex: 0x2B3A55)
        let mask = shape(pal, pose: pose)
        var canvas = PixelCanvas(width: size, height: size)
        paint(&canvas, mask: mask, body: body)
        face(&canvas, pose: pose, look: look, eyes: eyes, dy: lift(pose))
        return canvas
    }

    // MARK: - Shape

    /// How far the body moves down (positive) or up in a pose.
    static func lift(_ pose: Pose) -> Int {
        switch pose {
        case .bob, .walkB, .sad: 1
        case .cheer: -2
        default: 0
        }
    }

    /// Which pixels the pal covers.
    static func shape(_ pal: PalDefinition, pose: Pose) -> [Bool] {
        let k = bodyWidth / max(pal.body.primary.width, 1)
        let bodyHeight = pal.body.primary.height * k
        let dy = Double(lift(pose))
        let cx = centre.x, cy = centre.y + dy
        var mask = Array(repeating: false, count: size * size)
        func fill(_ inside: (Double, Double) -> Bool) {
            for y in 0..<size { for x in 0..<size where inside(Double(x) + 0.5, Double(y) + 0.5) { mask[y * size + x] = true } }
        }
        // Feet first: two small rounded pads under the body; the raised one when walking.
        let footY = centre.y + bodyHeight / 2 + 0.5 + (pose == .cheer ? dy : 0)
        for (side, raised) in [(-1.0, pose == .walkA), (1.0, pose == .walkB)] {
            let fx = cx + side * bodyWidth * 0.24, fy = footY - (raised ? 1 : 0)
            fill { x, y in pow((x - fx) / 2.6, 2) + pow((y - fy) / 1.7, 2) <= 1 }
        }
        // Arms: from the side of the body, hanging out at an angle that depends on the pose.
        for side in [-1.0, 1.0] {
            let angle = armAngle(pose, side: side) * .pi / 180
            let shoulder = (x: cx + side * (bodyWidth / 2 - 0.5), y: cy - 1 + (pose == .typeA || pose == .typeB ? 2 : 0))
            let hand = (x: shoulder.x + side * sin(angle) * 5, y: shoulder.y + cos(angle) * 5)
            fill { x, y in distance(x, y, shoulder, hand) <= 1.7 }
        }
        // The head's nodes (ears, horns, antenna), as the file draws them.
        for node in pal.body.nodes where node.position.count >= 2 && node.position[1] > pal.body.primary.height * 0.4 {
            let c = (x: cx + node.position[0] * k, y: cy - node.position[1] * k)
            let w = node.surface.width * k, h = node.surface.height * k
            let phi = (node.rotation.count >= 3 ? node.rotation[2] : 0) * .pi / 180
            // The node's "up", turned counter-clockwise by its rotation, in screen terms (y down).
            let u = (x: -sin(phi), y: -cos(phi)), v = (x: cos(phi), y: -sin(phi))
            switch node.surface.type {
            case "cone":
                fill { x, y in
                    let a = (x - c.x) * u.x + (y - c.y) * u.y, b = (x - c.x) * v.x + (y - c.y) * v.y
                    return a >= -h / 2 && a <= h / 2 && abs(b) <= max(0.6, w / 2 * (h / 2 - a) / h)
                }
            case "cube":
                fill { x, y in roundedBox(x, y, c, w, h, radius: min(w, h) * 0.3) }
            default:
                let half = max(0, h / 2 - w / 2)
                let a = (x: c.x - u.x * half, y: c.y - u.y * half), b = (x: c.x + u.x * half, y: c.y + u.y * half)
                fill { x, y in distance(x, y, a, b) <= max(0.8, w / 2) }
            }
        }
        // The body: a rounded box.
        fill { x, y in roundedBox(x, y, (cx, cy), bodyWidth, bodyHeight, radius: min(bodyWidth, bodyHeight) * 0.34) }
        return mask
    }

    /// Degrees out from hanging straight down.
    static func armAngle(_ pose: Pose, side: Double) -> Double {
        switch pose {
        case .cheer: 150
        case .typeA: side < 0 ? 4 : 14
        case .typeB: side < 0 ? 14 : 4
        case .walkA: side < 0 ? 20 : 45
        case .walkB: side < 0 ? 45 : 20
        case .sad: 8
        default: 32
        }
    }

    static func distance(_ x: Double, _ y: Double, _ a: (x: Double, y: Double), _ b: (x: Double, y: Double)) -> Double {
        let dx = b.x - a.x, dy = b.y - a.y
        let t = dx == 0 && dy == 0 ? 0 : max(0, min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)))
        return hypot(x - (a.x + t * dx), y - (a.y + t * dy))
    }

    static func roundedBox(_ x: Double, _ y: Double, _ c: (x: Double, y: Double), _ w: Double, _ h: Double, radius: Double) -> Bool {
        let qx = abs(x - c.x) - (w / 2 - radius), qy = abs(y - c.y) - (h / 2 - radius)
        if qx > radius || qy > radius { return false }
        return qx <= 0 || qy <= 0 || hypot(qx, qy) <= radius
    }

    // MARK: - Paint

    /// The body colour with light from the top left, a darker rim at the bottom and right, and a dark outline.
    static func paint(_ canvas: inout PixelCanvas, mask: [Bool], body: PixelColor) {
        func at(_ x: Int, _ y: Int) -> Bool { x >= 0 && y >= 0 && x < size && y < size && mask[y * size + x] }
        let outline = body.shade(0.42)
        for y in 0..<size {
            for x in 0..<size {
                if at(x, y) {
                    var c = body
                    if !at(x, y - 1) || !at(x - 1, y) { c = body.shade(1.07) }
                    if !at(x, y + 1) || !at(x + 1, y) { c = body.shade(0.84) } else if !at(x, y + 2) { c = body.shade(0.92) }
                    canvas.set(x, y, c)
                } else if at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1) {
                    canvas.set(x, y, outline)
                }
            }
        }
    }

    /// Eyes (two pixels wide, three tall, with a glint), blinking, happy arcs or sad with a tear; a little blush.
    static func face(_ canvas: inout PixelCanvas, pose: Pose, look: Int, eyes: PixelColor, dy: Int) {
        let row = Int(centre.y) - 1 + dy
        let shift = max(-1, min(1, look)) + (pose == .typeA || pose == .typeB ? -1 : 0)
        let left = 11 + shift, right = 19 + shift
        let blush = PixelColor(hex: 0xFF8FA8)
        switch pose {
        case .blink:
            for x in [left, right] { canvas.rect(x, row + 2, 2, 1, eyes) }
        case .cheer:
            for x in [left - 1, right] {
                canvas.set(x, row + 1, eyes)
                canvas.set(x + 1, row, eyes)
                canvas.set(x + 2, row + 1, eyes)
            }
            for x in [left - 2, right + 3] { canvas.set(x, row + 3, blush.with(alpha: 170)) }
        case .sad:
            for x in [left, right] { canvas.rect(x, row + 1, 2, 2, eyes) }
            canvas.set(left, row + 3, PixelColor(hex: 0x8FD3FF, alpha: 220))
        default:
            for x in [left, right] {
                canvas.rect(x, row, 2, 3, eyes)
                canvas.set(x, row, PixelColor(hex: 0xFFFFFF))
            }
            for x in [left - 2, right + 3] { canvas.set(x, row + 3, blush.with(alpha: 110)) }
        }
    }
}
