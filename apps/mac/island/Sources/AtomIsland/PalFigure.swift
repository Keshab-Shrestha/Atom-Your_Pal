import SwiftUI
import AtomIslandCore

/// ADR-089: draws a pal from its avatar definition: a rounded body that turns with the head, its nodes (ears, arms,
/// feet, antennae) placed in 3D and drawn back to front, and glossy eyes on the front face. ATOM's own drawing: soft
/// light from the top left, a rim of light, a highlight on the body and on each eye. Every frame is a pure function of
/// the pose and the time.
enum PalFigure {
    /// The model's extent, unturned, so the figure never jumps when it turns: feet at the bottom of `rect`, centred.
    private static func layout(_ d: PalDefinition, in rect: CGRect) -> (scale: CGFloat, centre: CGPoint) {
        var minX = -d.body.primary.width / 2, maxX = d.body.primary.width / 2
        var minY = -d.body.primary.height / 2, maxY = d.body.primary.height / 2
        for node in d.body.nodes where node.position.count >= 2 {
            let r = max(node.surface.width, node.surface.height) / 2
            minX = min(minX, node.position[0] - r)
            maxX = max(maxX, node.position[0] + r)
            minY = min(minY, node.position[1] - r * 0.9)
            maxY = max(maxY, node.position[1] + r * 0.9)
        }
        let scale = min(rect.width / (maxX - minX), rect.height / (maxY - minY))
        return (scale, CGPoint(x: rect.midX - (minX + maxX) / 2 * scale, y: rect.maxY + minY * scale))
    }

    private struct Turn {
        let yaw: Double, pitch: Double
        /// Body space (y up) to view space (y up, z toward the viewer).
        func apply(_ p: (Double, Double, Double)) -> (x: Double, y: Double, z: Double) {
            let (x, y, z) = p
            let x1 = x * cos(yaw) + z * sin(yaw), z1 = -x * sin(yaw) + z * cos(yaw)
            let y2 = y * cos(pitch) + z1 * sin(pitch), z2 = -y * sin(pitch) + z1 * cos(pitch)
            return (x1, y2, z2)
        }
    }

    static func draw(_ d: PalDefinition, pose: PalPose, time: Double, in context: GraphicsContext, rect: CGRect, glow: Bool) {
        let (scale, centre) = layout(d, in: rect)
        var ctx = context
        // Motion from the expression, and a slow breath always.
        var roll = pose.headZ
        var shift = CGSize.zero
        switch pose.bodyMotion {
        case "shake": shift.width = sin(time * 2 * .pi * 14) * 4 * scale
        case "slowDrift":
            roll += sin(time * 2 * .pi / 2.8) * 4
            shift.height = sin(time * 2 * .pi / 2.8) * 5 * scale
        default: break
        }
        let breath = 1 + 0.012 * sin(time * 2 * .pi / 3.2)
        ctx.translateBy(x: centre.x + shift.width, y: centre.y + shift.height)
        ctx.rotate(by: .degrees(-roll))
        ctx.scaleBy(x: scale, y: -scale * breath) // model units, y up
        let turn = Turn(yaw: pose.headY * .pi / 180, pitch: pose.headX * .pi / 180)
        let body = d.body.primary

        // Back to front: nodes behind the body, the body, nodes in front, then the eyes.
        let placed = d.body.nodes.enumerated().map { (i, node) -> (Int, PalDefinition.Node, (x: Double, y: Double, z: Double)) in
            let p = node.position + [0, 0, 0]
            return (i, node, turn.apply((p[0], p[1], p[2])))
        }
        for (_, node, at) in placed.sorted(by: { $0.2.z < $1.2.z }) where at.z < 0 {
            drawNode(node, at: at, pose: pose, in: ctx, behind: true, glow: glow)
        }
        drawBody(body, turn: turn, pose: pose, in: ctx, glow: glow)
        for (_, node, at) in placed.sorted(by: { $0.2.z < $1.2.z }) where at.z >= 0 {
            drawNode(node, at: at, pose: pose, in: ctx, behind: false, glow: glow)
        }
        drawEyes(body: body, turn: turn, pose: pose, time: time, in: ctx)
    }

    // MARK: - Light

    private static func color(_ c: PalRGB, _ opacity: Double = 1) -> Color { Color(red: c.r, green: c.g, blue: c.b).opacity(opacity) }
    private static let white = PalRGB(r: 1, g: 1, b: 1)
    private static let ink = PalRGB(r: 0.08, g: 0.09, b: 0.14)

    /// A soft volume: lit from the top left, darker toward the bottom right, a rim of light and a faint edge.
    private static func shade(_ path: Path, base: PalRGB, in ctx: GraphicsContext, bounds: CGRect, dim: Double = 0, glow: Bool) {
        let b = base.mix(ink, dim)
        // y is up here: the top of the shape is maxY.
        ctx.fill(path, with: .radialGradient(
            Gradient(stops: [
                .init(color: color(b.mix(white, 0.35)), location: 0),
                .init(color: color(b), location: 0.45),
                .init(color: color(b.mix(ink, 0.22)), location: 1),
            ]),
            center: CGPoint(x: bounds.minX + bounds.width * 0.32, y: bounds.minY + bounds.height * 0.74),
            startRadius: 0, endRadius: max(bounds.width, bounds.height) * 0.95))
        // A rim of light along the top edge, and a quiet edge so a light pal reads on a light desktop.
        ctx.stroke(path, with: .linearGradient(
            Gradient(colors: [color(white, glow ? 0.55 : 0.35), color(white, 0)]),
            startPoint: CGPoint(x: bounds.midX, y: bounds.maxY), endPoint: CGPoint(x: bounds.midX, y: bounds.midY)),
            lineWidth: max(bounds.width, bounds.height) * 0.025)
        ctx.stroke(path, with: .color(color(ink, 0.16)), lineWidth: max(bounds.width, bounds.height) * 0.012)
    }

    // MARK: - Body

    private static func drawBody(_ s: PalDefinition.Surface, turn: Turn, pose: PalPose, in ctx: GraphicsContext, glow: Bool) {
        let w = s.width * abs(cos(turn.yaw)) + s.depth * abs(sin(turn.yaw)) * 0.55
        let h = s.height * abs(cos(turn.pitch)) + s.depth * abs(sin(turn.pitch)) * 0.55
        let rect = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
        let radius = min(w, h) * min(0.48, 0.17 * (s.roundness ?? 1) + 0.08)
        let path = Path(roundedRect: rect, cornerRadius: radius, style: .continuous)
        shade(path, base: pose.body, in: ctx, bounds: rect, glow: glow)
        // The side turned away falls into shade.
        let side = sin(turn.yaw)
        if abs(side) > 0.02 {
            var shadowed = ctx
            shadowed.clip(to: path)
            let edge = side > 0 ? rect.maxX : rect.minX
            shadowed.fill(Path(rect), with: .linearGradient(
                Gradient(colors: [color(ink, 0.22 * min(1, abs(side) * 2)), color(ink, 0)]),
                startPoint: CGPoint(x: edge, y: 0), endPoint: CGPoint(x: edge - (side > 0 ? 1 : -1) * w * 0.35, y: 0)))
        }
        // A soft highlight high on the left: the gloss that makes it feel finished.
        let gloss = CGRect(x: rect.minX + w * 0.12, y: rect.maxY - h * 0.34, width: w * 0.42, height: h * 0.22)
        ctx.fill(Path(ellipseIn: gloss), with: .radialGradient(
            Gradient(colors: [color(white, 0.55), color(white, 0)]),
            center: CGPoint(x: gloss.midX, y: gloss.midY), startRadius: 0, endRadius: gloss.width * 0.55))
    }

    // MARK: - Nodes

    private static func drawNode(_ node: PalDefinition.Node, at p: (x: Double, y: Double, z: Double), pose: PalPose, in ctx: GraphicsContext,
                                 behind: Bool, glow: Bool) {
        let s = node.surface
        var local = ctx
        local.translateBy(x: p.x, y: p.y)
        local.rotate(by: .degrees((node.rotation.count > 2 ? node.rotation[2] : 0)))
        let rect = CGRect(x: -s.width / 2, y: -s.height / 2, width: s.width, height: s.height)
        let dim = behind ? 0.12 : 0
        switch s.type {
        case "cone":
            let r = min(s.width, s.height) * 0.11 * max(s.tipRoundness ?? 1, s.baseRoundness ?? 1) / 2 + 2
            let path = cone(width: s.width - r * 2.4, height: s.height - r * 2.2, morph: s.morphRoundness ?? 0)
            // A filled shape and a round-joined stroke of the same colour: rounded corners.
            local.fill(path, with: .color(color(pose.body.mix(ink, dim + 0.12))))
            local.stroke(path, with: .color(color(pose.body.mix(ink, dim + 0.12))), style: StrokeStyle(lineWidth: r * 2, lineJoin: .round))
            var inner = local
            inner.clip(to: path.strokedPath(StrokeStyle(lineWidth: r * 2, lineJoin: .round)).union(path))
            shade(Path(rect), base: pose.body, in: inner, bounds: rect, dim: dim, glow: glow)
        case "cube":
            let path = Path(roundedRect: rect, cornerRadius: min(s.width, s.height) * min(0.48, 0.17 * (s.roundness ?? 1) + 0.08), style: .continuous)
            shade(path, base: pose.body, in: local, bounds: rect, dim: dim, glow: glow)
        default: // capsule
            let path = Path(roundedRect: rect, cornerRadius: min(s.width, s.height) / 2, style: .continuous)
            shade(path, base: pose.body, in: local, bounds: rect, dim: dim, glow: glow)
        }
    }

    /// A cone seen from the side, tip up: a triangle whose sides bulge with `morph` (0 straight, 1 a dome).
    private static func cone(width w: Double, height h: Double, morph: Double) -> Path {
        let tip = CGPoint(x: 0, y: h / 2), left = CGPoint(x: -w / 2, y: -h / 2), right = CGPoint(x: w / 2, y: -h / 2)
        let bulge = w * 0.42 * morph
        var path = Path()
        path.move(to: left)
        path.addQuadCurve(to: tip, control: CGPoint(x: -w / 4 - bulge * 0.7, y: bulge * 0.6))
        path.addQuadCurve(to: right, control: CGPoint(x: w / 4 + bulge * 0.7, y: bulge * 0.6))
        path.addQuadCurve(to: left, control: CGPoint(x: 0, y: -h / 2 - bulge * 0.25))
        path.closeSubpath()
        return path
    }

    // MARK: - Eyes

    static let eyeScale = 1.45
    static let spacingScale = 1.22

    private static func drawEyes(body s: PalDefinition.Surface, turn: Turn, pose: PalPose, time: Double, in ctx: GraphicsContext) {
        let facing = cos(turn.yaw) * cos(turn.pitch)
        guard facing > 0.2 else { return }
        let jitter = pose.eyeMotion == "shake" ? sin(time * 2 * .pi * 18) * 2.5 : 0
        for (eye, side) in [(pose.left, -1.0), (pose.right, 1.0)] {
            // Drawn a little larger than the definition's numbers: big, glossy eyes carry the character at small sizes.
            let face = turn.apply((side * pose.spacing * spacingScale / 2 + eye.x + jitter, -eye.y, s.depth / 2 * 0.98))
            let w = eye.width * eyeScale * max(0.35, abs(cos(turn.yaw)))
            let h = max(7, eye.height * eyeScale * cos(turn.pitch) * (1 - 0.85 * pose.blink))
            var local = ctx
            local.translateBy(x: face.x, y: face.y)
            local.rotate(by: .degrees(eye.angle))
            let rect = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
            let shape = h < w * 0.42 ? Path(roundedRect: rect, cornerRadius: h / 2, style: .continuous) : Path(ellipseIn: rect)
            local.fill(shape, with: .radialGradient(
                Gradient(stops: [
                    .init(color: color(pose.eyes.mix(white, 0.28)), location: 0),
                    .init(color: color(pose.eyes), location: 0.55),
                    .init(color: color(pose.eyes.mix(ink, 0.45)), location: 1),
                ]),
                center: CGPoint(x: -w * 0.1, y: -h * 0.18), startRadius: 0, endRadius: max(w, h) * 0.7))
            guard h > 18 else { continue }
            // Two catchlights: the life in the eye.
            let big = min(w, h) * 0.24, small = min(w, h) * 0.1
            local.fill(Path(ellipseIn: CGRect(x: -w * 0.22 - big / 2, y: h * 0.2 - big / 2, width: big, height: big)), with: .color(.white.opacity(0.92)))
            local.fill(Path(ellipseIn: CGRect(x: w * 0.14 - small / 2, y: -h * 0.18 - small / 2, width: small, height: small)), with: .color(.white.opacity(0.6)))
        }
    }
}

/// A pal on its own (the ATOM window, the island card, the gallery): its character playing `animation`.
struct PalPortrait: View {
    let character: PalDefinition
    var animation = "idle"
    var time: Double = 0
    var size: CGFloat = 64
    var glow = true

    var body: some View {
        Canvas { context, canvas in
            let pose = PalPose.at(character, animation: animation, time: time)
            // A soft contact shadow, so the pal stands on something.
            let floor = CGRect(x: canvas.width * 0.24, y: canvas.height * 0.9, width: canvas.width * 0.52, height: canvas.height * 0.07)
            context.fill(Path(ellipseIn: floor), with: .radialGradient(Gradient(colors: [.black.opacity(0.28), .black.opacity(0)]),
                                                                       center: CGPoint(x: floor.midX, y: floor.midY), startRadius: 0, endRadius: floor.width / 2))
            PalFigure.draw(character, pose: pose, time: time, in: context, rect: CGRect(origin: .zero, size: canvas).insetBy(dx: canvas.width * 0.04, dy: canvas.height * 0.06), glow: glow)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
