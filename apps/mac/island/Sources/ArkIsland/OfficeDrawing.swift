import SwiftUI
import ArkIslandCore

/// ARK Studio as an architect's blueprint (2026-11-02, Keshab: "change board to different art style"): hairline furniture on a
/// gridded print, walls as solid rules, door swings, a dimension line and a title block. Furniture anchors match OfficeMap so
/// tasks, walking and click targets keep their meaning. Only live things (a working screen, alerts, notes, confetti) are in colour.
enum OfficeDrawing {
    private static let width = CGFloat(OfficeMap.width), height = CGFloat(OfficeMap.height)
    /// The Studio's bulb, set by the floor before it draws: off is a navy print with white lines, on a pale print with blue lines.
    /// The print ignores the app theme, so a dark theme no longer turns the floor near-black.
    /// ponytail: one global; the floor is the only caller and draws on the main thread.
    nonisolated(unsafe) static var lightsOn = false

    static func paper(lightsOn on: Bool) -> Color { on ? Color(red: 0.95, green: 0.97, blue: 0.99) : Color(red: 0.11, green: 0.29, blue: 0.52) }
    static func line(lightsOn on: Bool) -> Color { on ? Color(red: 0.15, green: 0.36, blue: 0.63) : Color(red: 0.88, green: 0.94, blue: 1) }
    private static var paper: Color { paper(lightsOn: lightsOn) }
    private static var line: Color { line(lightsOn: lightsOn) }
    /// A working screen and confetti: bright cyan on either print.
    private static var live: Color { lightsOn ? Color(red: 0.05, green: 0.55, blue: 0.85) : Color(red: 0.55, green: 0.92, blue: 1) }
    private static let amber = Color(red: 0.93, green: 0.66, blue: 0.22)
    private static let red = Color(red: 0.88, green: 0.38, blue: 0.33)

    private static func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat = 1.5) -> Path {
        Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: r, style: .continuous)
    }
    /// One drawn part: bare paper (`solid`) or the grid showing through, a wash of line colour (`tint`), then its outline.
    private static func part(_ g: GraphicsContext, _ shape: Path, tint: Double = 0, width: CGFloat = 0.5, dash: [CGFloat] = [], solid: Bool = true) {
        if solid { g.fill(shape, with: .color(paper)) }
        if tint > 0 { g.fill(shape, with: .color(line.opacity(tint))) }
        g.stroke(shape, with: .color(line.opacity(0.9)), style: StrokeStyle(lineWidth: width, lineJoin: .round, dash: dash))
    }
    private static func label(_ g: GraphicsContext, _ text: String, _ x: CGFloat, _ y: CGFloat, size: CGFloat = 3.4, opacity: Double = 0.85,
                              anchor: UnitPoint = .topLeading) {
        g.draw(Text(text.uppercased()).font(.system(size: size, weight: .medium, design: .monospaced)).tracking(0.3)
            .foregroundColor(line.opacity(opacity)), at: CGPoint(x: x, y: y), anchor: anchor)
    }

    static func background(_ g: GraphicsContext) {
        g.fill(Path(CGRect(x: 0, y: 0, width: width, height: height)), with: .color(paper))
        // The print's grid: a fine line every 8 units, a heavier one every 32.
        var fine = Path(), major = Path()
        for x in stride(from: CGFloat(0), through: width, by: 8) {
            let rule = Path { $0.move(to: CGPoint(x: x, y: 31)); $0.addLine(to: CGPoint(x: x, y: height)) }
            if x.truncatingRemainder(dividingBy: 32) == 0 { major.addPath(rule) } else { fine.addPath(rule) }
        }
        for y in stride(from: CGFloat(32), through: height, by: 8) {
            let rule = Path { $0.move(to: CGPoint(x: 0, y: y)); $0.addLine(to: CGPoint(x: width, y: y)) }
            if y.truncatingRemainder(dividingBy: 32) == 0 { major.addPath(rule) } else { fine.addPath(rule) }
        }
        g.stroke(fine, with: .color(line.opacity(0.07)), lineWidth: 0.25)
        g.stroke(major, with: .color(line.opacity(0.16)), lineWidth: 0.35)
        // The title strip, closed by a double rule.
        var rule = Path()
        for y in [CGFloat(29), 30.4] { rule.move(to: CGPoint(x: 0, y: y)); rule.addLine(to: CGPoint(x: width, y: y)) }
        g.stroke(rule, with: .color(line.opacity(0.8)), lineWidth: 0.4)
        label(g, "ARK Studio", 9, 8, size: 4.4, opacity: 0.95)
        label(g, "Plan · floor 1", 9, 16, size: 2.8, opacity: 0.6)
        // The attention board keeps the original notes' coordinates and live count.
        part(g, box(159, 4, 43, 22), tint: 0.1)
        label(g, "Needs you", 210, 11)
        // Rooms: heavy outlines with the grid showing through.
        part(g, box(5, 34, 88, 69, 2), tint: 0.05, width: 0.9, solid: false)
        label(g, "ARK", 12, 39)
        part(g, box(23, 157, 96, 46, 2), tint: 0.03, width: 0.6, dash: [2, 1.5], solid: false)
        label(g, "Collaborate", 28, 193)
        part(g, box(211, 113, 104, 90, 2), tint: 0.05, width: 0.9, solid: false)
        label(g, "Recharge", 217, 117)
        // Walls as solid rules; the gaps are the doors, with their swings.
        for wall in [box(94, 33, 2, 46, 0), box(94, 96, 2, 12, 0), box(5, 107, 89, 2, 0), box(207, 113, 2, 45, 0), box(207, 177, 2, 23, 0)] {
            g.fill(wall, with: .color(line.opacity(0.85)))
        }
        door(g, hinge: CGPoint(x: 95, y: 79), leaf: CGPoint(x: 78, y: 79), swing: CGPoint(x: 95, y: 96))
        door(g, hinge: CGPoint(x: 208, y: 158), leaf: CGPoint(x: 227, y: 158), swing: CGPoint(x: 208, y: 177))
        dimension(g, from: 112, to: 288, y: 37, "11 000")
        for index in OfficeMap.desks.indices {
            if let seat = OfficeMap.seat(index) { chair(g, x: seat.point.x, y: seat.point.y - 4) }
        }
        chair(g, x: OfficeMap.managerSeat.x, y: OfficeMap.managerSeat.y - 5)
        for i in OfficeMap.meetingSeats.indices {
            if let seat = OfficeMap.seat(OfficeMap.desks.count + i) { chair(g, x: seat.point.x, y: seat.point.y - 3) }
        }
        // A sofa behind the two lounge seats, its cushions ruled off. Its front is drawn after the actors.
        part(g, box(235, 151, 58, 17, 3), tint: 0.15)
        var seams = Path()
        for x in [CGFloat(254.3), 273.6] { seams.move(to: CGPoint(x: x, y: 153)); seams.addLine(to: CGPoint(x: x, y: 166)) }
        g.stroke(seams, with: .color(line.opacity(0.5)), lineWidth: 0.3)
        for point in [(101.0, 36.0), (307.0, 37.0), (8.0, 190.0), (306.0, 190.0)] { plant(g, point.0, point.1) }
        part(g, box(263, 126, 42, 9, 1))
        part(g, box(271, 123, 6, 4, 1), tint: 0.3)
        part(g, box(290, 121, 6, 6, 1), tint: 0.3)
        titleBlock(g, CGRect(x: 128, y: 182, width: 74, height: 20))
    }

    static func foreground(_ g: GraphicsContext) {
        for (i, d) in OfficeMap.desks.enumerated() { desk(g, x: CGFloat(d.x * 16), y: CGFloat(d.y * 16), index: i) }
        desk(g, x: CGFloat(OfficeMap.managerDesk.x * 16), y: CGFloat(OfficeMap.managerDesk.y * 16), index: -1)
        part(g, box(32, 174, 80, 12, 2), tint: 0.08)
        for x in [CGFloat(48), 73, 94] { part(g, box(x, 176, 10, 6, 0.5), tint: 0.2, width: 0.3) }
        part(g, box(235, 168, 58, 7, 2), tint: 0.25)
        part(g, box(250, 185, 24, 8, 3), tint: 0.1)
        part(g, box(259, 184, 8, 3, 1))
    }

    /// A door: its leaf and the quarter circle it sweeps.
    private static func door(_ g: GraphicsContext, hinge: CGPoint, leaf: CGPoint, swing: CGPoint) {
        var p = Path()
        p.move(to: hinge); p.addLine(to: leaf)
        p.move(to: leaf); p.addQuadCurve(to: swing, control: CGPoint(x: leaf.x + swing.x - hinge.x, y: leaf.y + swing.y - hinge.y))
        g.stroke(p, with: .color(line.opacity(0.55)), style: StrokeStyle(lineWidth: 0.35, dash: [1, 0.8]))
    }
    /// A dimension line with tick marks and its length (in millimetres, as on a real print) above it.
    private static func dimension(_ g: GraphicsContext, from x0: CGFloat, to x1: CGFloat, y: CGFloat, _ text: String) {
        var p = Path()
        p.move(to: CGPoint(x: x0, y: y)); p.addLine(to: CGPoint(x: x1, y: y))
        for x in [x0, x1] {
            p.move(to: CGPoint(x: x, y: y - 2)); p.addLine(to: CGPoint(x: x, y: y + 2))
            p.move(to: CGPoint(x: x - 1.2, y: y + 1.2)); p.addLine(to: CGPoint(x: x + 1.2, y: y - 1.2))
        }
        g.stroke(p, with: .color(line.opacity(0.5)), lineWidth: 0.3)
        label(g, text, (x0 + x1) / 2, y - 0.6, size: 2.6, opacity: 0.7, anchor: .bottom)
    }
    private static func titleBlock(_ g: GraphicsContext, _ rect: CGRect) {
        part(g, Path(rect), width: 0.45)
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.midY)); p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        p.move(to: CGPoint(x: rect.minX + 46, y: rect.midY)); p.addLine(to: CGPoint(x: rect.minX + 46, y: rect.maxY))
        g.stroke(p, with: .color(line.opacity(0.6)), lineWidth: 0.3)
        label(g, "ARK · Studio", rect.minX + 2.5, rect.minY + 2.8, size: 3, opacity: 0.9)
        label(g, "Scale 1:50", rect.minX + 2.5, rect.midY + 2.8, size: 2.4, opacity: 0.65)
        label(g, "Sheet A-1", rect.minX + 48.5, rect.midY + 2.8, size: 2.4, opacity: 0.65)
    }

    private static func chair(_ g: GraphicsContext, x: CGFloat, y: CGFloat) {
        part(g, box(x - 6, y - 6, 12, 11, 4), tint: 0.12)
    }
    private static func desk(_ g: GraphicsContext, x: CGFloat, y: CGFloat, index: Int) {
        part(g, box(x - 1, y + 3, 34, 13, 1.5), tint: index < 0 ? 0.18 : 0.08)
        part(g, box(x + 3, y + 7, 24, 5, 1), width: 0.3)
        // A compact display with its baseline inside the desk's map cell.
        part(g, box(x + 2, y - 8, 14, 11, 1), tint: 0.3)
        g.fill(box(x + 3.5, y - 6.5, 11, 7, 0.6), with: .color(line.opacity(0.12)))
        for row in 0..<3 { g.fill(box(x + 5, y - 5 + CGFloat(row) * 2, CGFloat(6 - row), 0.5, 0.25), with: .color(line.opacity(0.5))) }
        part(g, box(x + 7, y + 3, 13, 2.7, 0.8), tint: 0.2, width: 0.3)
        part(g, Path(ellipseIn: CGRect(x: x + 26, y: y + 5, width: 3, height: 3)), width: 0.35)
    }
    /// A plant in plan: its pot's circle with the leaves as spokes.
    private static func plant(_ g: GraphicsContext, _ x: CGFloat, _ y: CGFloat) {
        part(g, Path(ellipseIn: CGRect(x: x - 4.5, y: y - 4.5, width: 9, height: 9)), tint: 0.06)
        var leaves = Path()
        for i in 0..<6 {
            let a = Double(i) * .pi / 3 + 0.3
            leaves.move(to: CGPoint(x: x + cos(a) * 1.2, y: y + sin(a) * 1.2))
            leaves.addLine(to: CGPoint(x: x + cos(a) * 3.6, y: y + sin(a) * 3.6))
        }
        g.stroke(leaves, with: .color(line.opacity(0.7)), style: StrokeStyle(lineWidth: 0.4, lineCap: .round))
    }
    static func monitorGlow(_ g: GraphicsContext, x: CGFloat, y: CGFloat, frame: Int) {
        g.fill(box(x + 3.5, y + 2.5, 11, 7, 0.6), with: .color(paper))
        g.fill(box(x + 3.5, y + 2.5, 11, 7, 0.6), with: .color(live.opacity(0.28)))
        let rows = live.opacity(frame % 2 == 0 ? 1 : 0.7)
        for row in 0..<3 { g.fill(box(x + 5, y + 4 + CGFloat(row) * 2, CGFloat(7 - row), 0.7, 0.3), with: .color(rows)) }
        g.fill(Path(ellipseIn: CGRect(x: x + 12.5, y: y + 3.5, width: 1, height: 1)), with: .color(live))
    }
    static func hand(_ g: GraphicsContext, x: CGFloat, y: CGFloat, body: PalRGB) {
        g.fill(box(x, y, 3.5, 2.5, 1.2), with: .color(Color(red: body.r, green: body.g, blue: body.b)))
    }
    static func envelope(_ g: GraphicsContext, x: CGFloat, y: CGFloat) {
        part(g, box(x, y, 10, 7, 1))
        var p = Path(); p.move(to: CGPoint(x: x + 1, y: y + 1)); p.addLine(to: CGPoint(x: x + 5, y: y + 4)); p.addLine(to: CGPoint(x: x + 9, y: y + 1))
        g.stroke(p, with: .color(line), lineWidth: 0.5)
    }
    static func alert(_ g: GraphicsContext, x: CGFloat, y: CGFloat, failed: Bool) {
        g.fill(Path(ellipseIn: CGRect(x: x - 2, y: y - 1, width: 9, height: 11)), with: .color(failed ? red : amber))
        g.draw(Text("!").font(.system(size: 3.8, weight: .bold)).foregroundColor(.white), at: CGPoint(x: x + 1, y: y + 1), anchor: .topLeading)
    }
    /// A "+N" sign: a white card, so its dark words read on either print.
    static func sign(_ g: GraphicsContext, _ rect: CGRect) {
        let shape = box(rect.minX, rect.minY, rect.width, rect.height, 2)
        g.fill(shape, with: .color(.white))
        g.stroke(shape, with: .color(line.opacity(0.9)), lineWidth: 0.5)
    }
    /// The "Needs you" board with nothing on it says so (hand check 2026-11-05: an empty box read as missing content).
    static func allClear(_ g: GraphicsContext) {
        label(g, "All clear", 168, 13, size: 3, opacity: 0.55)
    }

    static func note(_ g: GraphicsContext, index: Int, x: CGFloat, y: CGFloat) {
        g.fill(box(x, y, 5, 5, 0.6), with: .color(index % 2 == 0 ? amber : live))
        g.fill(box(x + 1, y + 1.8, 3, 0.6, 0.3), with: .color(.black.opacity(0.4)))
    }
    static func confetti(_ g: GraphicsContext, at point: CGPoint, frame: Int) {
        for i in 0..<5 {
            let x = point.x + CGFloat(i - 2) * 3, y = point.y - 24 - CGFloat((frame + i) % 4)
            g.fill(box(x, y, 1.4, 2.4, 0.5), with: .color(i % 2 == 0 ? live : amber))
        }
    }
}
