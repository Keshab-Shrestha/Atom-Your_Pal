import SwiftUI
import ZenoIslandCore

/// ADR-104: Pal (and every worker's pal on the office floor) as smooth 2D vector art. It reads where each part sits
/// from `PalStance` (on a 32-unit grid, the pal's own file), and draws soft rounded forms: a faint outline, a gentle
/// gradient lit from the top left, a rim of light, glossy eyes with a catchlight and a blush. Antialiased at any size;
/// nothing is a bitmap. Every frame is a pure function of the pose.
enum PalDrawing {
    private static let white = PalRGB(r: 1, g: 1, b: 1)
    private static let ink = PalRGB(r: 0.08, g: 0.09, b: 0.14)

    private static func color(_ c: PalRGB, _ opacity: Double = 1) -> Color { Color(red: c.r, green: c.g, blue: c.b).opacity(opacity) }

    private static func scaled(_ c: PalRGB, _ f: Double) -> PalRGB {
        PalRGB(r: max(0, min(1, c.r * f)), g: max(0, min(1, c.g * f)), b: max(0, min(1, c.b * f)))
    }

    /// One piece of the body: a filled shape, or a line with round ends (an arm).
    private struct Part {
        var path: Path
        var lineWidth: CGFloat?
        var bounds: CGRect { lineWidth.map { path.boundingRect.insetBy(dx: -$0 / 2, dy: -$0 / 2) } ?? path.boundingRect }
    }

    /// Draws `pal` in `pose` with its top left at `origin`; one grid unit is `unit` points. `look` moves the eyes
    /// aside (-1 left, 1 right). `shadow` adds a soft contact shadow on the ground.
    static func draw(_ pal: PalDefinition, pose: PalStance.Pose, look: Int, in context: GraphicsContext, origin: CGPoint, unit: CGFloat, shadow: Bool) {
        var ctx = context
        ctx.translateBy(x: origin.x, y: origin.y)
        ctx.scaleBy(x: unit, y: unit)
        let base = PalRGB(hex: pal.colors.body) ?? PalRGB(r: 0.95, g: 0.95, b: 0.95)
        let eyes = PalRGB(hex: pal.colors.eyes) ?? PalRGB(r: 0.17, g: 0.23, b: 0.33)
        let centre = PalStance.bodyCentre(pose), height = PalStance.bodyHeight(pal)

        if shadow { drawShadow(in: ctx, x: centre.x, y: PalStance.centre.y + height / 2 + 1.6) }

        // Back to front: feet, arms, head nodes, body.
        var parts: [Part] = []
        for foot in PalStance.feet(pal, pose: pose) {
            parts.append(Part(path: Path(ellipseIn: CGRect(x: foot.x - 2.7, y: foot.y - 1.8, width: 5.4, height: 3.6))))
        }
        for arm in PalStance.arms(pose) {
            var line = Path()
            line.move(to: CGPoint(x: arm.shoulder.x, y: arm.shoulder.y))
            line.addLine(to: CGPoint(x: arm.hand.x, y: arm.hand.y))
            parts.append(Part(path: line, lineWidth: 3.3))
        }
        parts += PalStance.headNodes(pal, pose: pose).map { Part(path: nodePath($0)) }
        let bodyRect = CGRect(x: centre.x - PalStance.bodyWidth / 2, y: centre.y - height / 2, width: PalStance.bodyWidth, height: height)
        let bodyPath = Path(roundedRect: bodyRect, cornerRadius: min(PalStance.bodyWidth, height) * 0.36, style: .continuous)
        parts.append(Part(path: bodyPath))

        // A faint outline round the whole figure first, then each piece lit on top.
        let edge = color(scaled(base, 0.5), 0.9)
        for part in parts {
            if let w = part.lineWidth {
                ctx.stroke(part.path, with: .color(edge), style: StrokeStyle(lineWidth: w + 1.1, lineCap: .round))
            } else {
                ctx.fill(part.path, with: .color(edge))
                ctx.stroke(part.path, with: .color(edge), style: StrokeStyle(lineWidth: 1.1, lineJoin: .round))
            }
        }
        for part in parts {
            let b = part.bounds
            let gradient = Gradient(stops: [
                .init(color: color(base.mix(white, 0.3)), location: 0),
                .init(color: color(base), location: 0.5),
                .init(color: color(base.mix(ink, 0.2)), location: 1),
            ])
            let shading = GraphicsContext.Shading.linearGradient(gradient, startPoint: CGPoint(x: b.minX + b.width * 0.15, y: b.minY),
                                                                 endPoint: CGPoint(x: b.maxX - b.width * 0.1, y: b.maxY))
            if let w = part.lineWidth {
                ctx.stroke(part.path, with: shading, style: StrokeStyle(lineWidth: w, lineCap: .round))
            } else {
                ctx.fill(part.path, with: shading)
            }
        }
        finishBody(bodyPath, rect: bodyRect, in: ctx)
        drawFace(pose: pose, look: look, eyes: eyes, centre: centre, in: ctx)
    }

    private static func drawShadow(in ctx: GraphicsContext, x: Double, y: Double) {
        let rect = CGRect(x: x - 8.5, y: y - 1.6, width: 17, height: 3.2)
        ctx.fill(Path(ellipseIn: rect), with: .radialGradient(Gradient(colors: [.black.opacity(0.22), .black.opacity(0)]),
                                                               center: CGPoint(x: rect.midX, y: rect.midY), startRadius: 0, endRadius: rect.width / 2))
    }

    // MARK: - Nodes

    /// An ear, horn or antenna: its own shape, turned as its file says.
    private static func nodePath(_ n: PalStance.Node) -> Path {
        let w = max(n.width, 1.6), h = max(n.height, 1.6)
        let local: Path
        switch n.type {
        case "cone":
            local = roundedPolygon([CGPoint(x: 0, y: -h / 2), CGPoint(x: w / 2, y: h / 2), CGPoint(x: -w / 2, y: h / 2)], radius: min(w, h) * 0.22)
        case "cube":
            local = Path(roundedRect: CGRect(x: -w / 2, y: -h / 2, width: w, height: h), cornerRadius: min(w, h) * 0.3, style: .continuous)
        default:
            local = Path(roundedRect: CGRect(x: -w / 2, y: -h / 2, width: w, height: max(h, w)), cornerRadius: min(w, h) / 2, style: .continuous)
        }
        // The file's turn is counter-clockwise on screen; a SwiftUI rotation is clockwise.
        let turn = CGAffineTransform(rotationAngle: -n.rotation * .pi / 180).concatenating(CGAffineTransform(translationX: n.x, y: n.y))
        return local.applying(turn)
    }

    /// A polygon with softly rounded corners.
    private static func roundedPolygon(_ points: [CGPoint], radius: CGFloat) -> Path {
        var path = Path()
        let n = points.count
        path.move(to: CGPoint(x: (points[0].x + points[n - 1].x) / 2, y: (points[0].y + points[n - 1].y) / 2))
        for i in 0..<n { path.addArc(tangent1End: points[i], tangent2End: points[(i + 1) % n], radius: radius) }
        path.closeSubpath()
        return path
    }

    // MARK: - Body finish and face

    /// A rim of light along the top, and a soft gloss high on the left.
    private static func finishBody(_ path: Path, rect: CGRect, in context: GraphicsContext) {
        var ctx = context
        ctx.clip(to: path)
        let gloss = CGRect(x: rect.minX + rect.width * 0.1, y: rect.minY + rect.height * 0.06, width: rect.width * 0.46, height: rect.height * 0.28)
        ctx.fill(Path(ellipseIn: gloss), with: .radialGradient(Gradient(colors: [color(white, 0.5), color(white, 0)]),
                                                                center: CGPoint(x: gloss.midX, y: gloss.midY), startRadius: 0, endRadius: gloss.width * 0.55))
        ctx.stroke(path, with: .linearGradient(Gradient(colors: [color(white, 0.45), color(white, 0)]),
                                               startPoint: CGPoint(x: rect.midX, y: rect.minY), endPoint: CGPoint(x: rect.midX, y: rect.midY)),
                   lineWidth: 1.2)
    }

    private static func drawFace(pose: PalStance.Pose, look: Int, eyes: PalRGB, centre: (x: Double, y: Double), in ctx: GraphicsContext) {
        let dy = centre.y - PalStance.centre.y
        let typing = pose == .typeA || pose == .typeB
        let shift = Double(max(-1, min(1, look))) + (typing ? -1 : 0)
        let lx = 12 + shift, rx = 20 + shift, y = 18.5 + dy
        let blush = PalRGB(r: 1, g: 0.56, b: 0.66)
        func cheek(_ x: Double, _ strength: Double) {
            let r = CGRect(x: x - 1.4, y: y + 2 - 0.9, width: 2.8, height: 1.8)
            ctx.fill(Path(ellipseIn: r), with: .radialGradient(Gradient(colors: [color(blush, strength), color(blush, 0)]),
                                                               center: CGPoint(x: r.midX, y: r.midY), startRadius: 0, endRadius: 1.5))
        }
        func stroke(_ path: Path) {
            ctx.stroke(path, with: .color(color(eyes)), style: StrokeStyle(lineWidth: 0.95, lineCap: .round, lineJoin: .round))
        }
        switch pose {
        case .blink:
            for x in [lx, rx] {
                var p = Path()
                p.move(to: CGPoint(x: x - 1.3, y: y + 1))
                p.addQuadCurve(to: CGPoint(x: x + 1.3, y: y + 1), control: CGPoint(x: x, y: y + 2.2))
                stroke(p)
            }
        case .cheer:
            for x in [lx, rx] {
                var p = Path()
                p.move(to: CGPoint(x: x - 1.5, y: y + 0.9))
                p.addQuadCurve(to: CGPoint(x: x + 1.5, y: y + 0.9), control: CGPoint(x: x, y: y - 1.1))
                stroke(p)
            }
            cheek(lx - 2.4, 0.6)
            cheek(rx + 2.4, 0.6)
        case .sad:
            for x in [lx, rx] { eye(CGRect(x: x - 1.15, y: y - 0.1, width: 2.3, height: 2.5), eyes, ctx, catchlight: false) }
            let tear = CGRect(x: lx - 0.6, y: y + 2.5, width: 1.2, height: 1.6)
            ctx.fill(Path(ellipseIn: tear), with: .color(Color(red: 0.56, green: 0.83, blue: 1).opacity(0.85)))
        default:
            for x in [lx, rx] { eye(CGRect(x: x - 1.25, y: y - 1.8, width: 2.5, height: 3.6), eyes, ctx, catchlight: true) }
            cheek(lx - 2.4, 0.4)
            cheek(rx + 2.4, 0.4)
        }
    }

    /// A glossy eye: its colour deepening toward the edge, with a catchlight.
    private static func eye(_ rect: CGRect, _ colour: PalRGB, _ ctx: GraphicsContext, catchlight: Bool) {
        ctx.fill(Path(ellipseIn: rect), with: .radialGradient(
            Gradient(stops: [.init(color: color(colour.mix(white, 0.22)), location: 0), .init(color: color(colour), location: 0.55),
                             .init(color: color(colour.mix(ink, 0.35)), location: 1)]),
            center: CGPoint(x: rect.midX - rect.width * 0.1, y: rect.midY - rect.height * 0.15), startRadius: 0, endRadius: rect.height * 0.7))
        guard catchlight else { return }
        let glint = CGRect(x: rect.minX + rect.width * 0.2, y: rect.minY + rect.height * 0.12, width: rect.width * 0.38, height: rect.width * 0.38)
        ctx.fill(Path(ellipseIn: glint), with: .color(.white.opacity(0.95)))
    }
}
