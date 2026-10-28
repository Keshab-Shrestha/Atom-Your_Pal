import SwiftUI
import AtomIslandCore

/// ATOM Studio: an original vector workspace on the existing walkable map.
/// Furniture anchors match OfficeMap so tasks, walking and click targets retain their meaning.
enum OfficeDrawing {
    private static let width = CGFloat(OfficeMap.width), height = CGFloat(OfficeMap.height)
    private static func c(_ value: UInt32, _ opacity: Double = 1) -> Color {
        Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255).opacity(opacity)
    }
    private static func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat = 3) -> Path {
        Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: r, style: .continuous)
    }
    private static func panel(_ g: GraphicsContext, _ rect: CGRect, fill: UInt32, edge: UInt32, radius: CGFloat = 6) {
        let shape = Path(roundedRect: rect, cornerRadius: radius, style: .continuous)
        g.fill(shape.offsetBy(dx: 0, dy: 1.2), with: .color(.black.opacity(0.07)))
        g.fill(shape, with: .color(c(fill)))
        g.stroke(shape, with: .color(c(edge)), lineWidth: 0.6)
    }
    private static func label(_ g: GraphicsContext, _ text: String, _ x: CGFloat, _ y: CGFloat, color: UInt32 = 0x667D80) {
        g.draw(Text(text).font(.system(size: 3.8, weight: .semibold, design: .rounded)).foregroundColor(c(color)), at: CGPoint(x: x, y: y), anchor: .topLeading)
    }

    static func background(_ g: GraphicsContext) {
        g.fill(Path(CGRect(x: 0, y: 0, width: width, height: height)), with: .color(c(0xE9EFEC)))
        // Quiet architectural grid, with the aisles left open for walking.
        var grid = Path()
        for x in stride(from: CGFloat(0), through: width, by: 16) { grid.move(to: CGPoint(x: x, y: 30)); grid.addLine(to: CGPoint(x: x, y: height)) }
        for y in stride(from: CGFloat(32), through: height, by: 16) { grid.move(to: CGPoint(x: 0, y: y)); grid.addLine(to: CGPoint(x: width, y: y)) }
        g.stroke(grid, with: .color(c(0xC9D8D2, 0.4)), lineWidth: 0.4)
        g.fill(box(0, 0, width, 29, 0), with: .color(c(0x183B3D)))
        label(g, "ATOM / STUDIO", 9, 10, color: 0xCDECE1)
        // The attention display retains the original notes' coordinates and live count.
        panel(g, CGRect(x: 159, y: 4, width: 43, height: 22), fill: 0x0F292F, edge: 0x4B7271, radius: 4)
        label(g, "NEEDS YOU", 210, 11, color: 0xA8D7CD)
        for x in [CGFloat(282), 289, 296] { g.fill(box(x, 11, 4, 4, 2), with: .color(c(0x76B8AA, x == 282 ? 1 : 0.3))) }
        panel(g, CGRect(x: 5, y: 34, width: 88, height: 69), fill: 0xD8E8E2, edge: 0xB2CDC2, radius: 10)
        label(g, "ATOM", 12, 39, color: 0x3C6F64)
        // Small collaboration zone and a warm, separate place for idle agents.
        panel(g, CGRect(x: 23, y: 157, width: 96, height: 46), fill: 0xDDE7E9, edge: 0xC5D4D7, radius: 10)
        label(g, "COLLABORATE", 28, 193)
        panel(g, CGRect(x: 211, y: 113, width: 104, height: 90), fill: 0xEEE4D6, edge: 0xD7C9B5, radius: 10)
        label(g, "RECHARGE", 217, 117, color: 0x927E66)
        // Low partitions leave the existing doors and walk routes visible.
        g.fill(box(94, 33, 2, 46, 1), with: .color(c(0xB2C7BF)))
        g.fill(box(94, 96, 2, 12, 1), with: .color(c(0xB2C7BF)))
        g.fill(box(5, 107, 89, 2, 1), with: .color(c(0xB2C7BF)))
        g.fill(box(207, 113, 2, 45, 1), with: .color(c(0xD0C1AB)))
        g.fill(box(207, 177, 2, 23, 1), with: .color(c(0xD0C1AB)))
        for index in OfficeMap.desks.indices {
            if let seat = OfficeMap.seat(index) { chair(g, x: seat.point.x, y: seat.point.y - 4) }
        }
        chair(g, x: OfficeMap.managerSeat.x, y: OfficeMap.managerSeat.y - 5)
        for i in OfficeMap.meetingSeats.indices {
            if let seat = OfficeMap.seat(OfficeMap.desks.count + i) { chair(g, x: seat.point.x, y: seat.point.y - 3) }
        }
        // A sofa behind the two lounge seats. Its front is drawn after the actors.
        panel(g, CGRect(x: 235, y: 151, width: 58, height: 17), fill: 0xB7C8B6, edge: 0x8FA58E, radius: 6)
        for point in [(101.0, 36.0), (307.0, 37.0), (8.0, 190.0), (306.0, 190.0)] { plant(g, point.0, point.1) }
        panel(g, CGRect(x: 263, y: 126, width: 42, height: 9), fill: 0xF9F4EB, edge: 0xD4C8B6, radius: 2)
        g.fill(box(271, 123, 6, 4, 1), with: .color(c(0x8C9D8E)))
        g.fill(box(290, 121, 6, 6, 1.2), with: .color(c(0x244B4C)))
    }

    static func foreground(_ g: GraphicsContext) {
        for (i, d) in OfficeMap.desks.enumerated() { desk(g, x: CGFloat(d.x * 16), y: CGFloat(d.y * 16), index: i) }
        desk(g, x: CGFloat(OfficeMap.managerDesk.x * 16), y: CGFloat(OfficeMap.managerDesk.y * 16), index: -1)
        panel(g, CGRect(x: 32, y: 174, width: 80, height: 12), fill: 0xF9FCFB, edge: 0xB6C8C7, radius: 5)
        for x in [CGFloat(48), 73, 94] { g.fill(box(x, 176, 10, 6, 1), with: .color(c(0xC8DAD8))) }
        panel(g, CGRect(x: 235, y: 168, width: 58, height: 7), fill: 0x8FA88E, edge: 0x81987E, radius: 3)
        panel(g, CGRect(x: 250, y: 185, width: 24, height: 8), fill: 0xD8C4A7, edge: 0xC0AA8C, radius: 4)
        g.fill(box(259, 184, 8, 3, 1), with: .color(c(0xF8F2E7)))
    }

    private static func chair(_ g: GraphicsContext, x: CGFloat, y: CGFloat) {
        g.fill(box(x - 6, y - 6, 12, 11, 4), with: .color(c(0x9FB7B2)))
        g.stroke(box(x - 6, y - 6, 12, 11, 4), with: .color(c(0x829E98)), lineWidth: 0.6)
    }
    private static func desk(_ g: GraphicsContext, x: CGFloat, y: CGFloat, index: Int) {
        panel(g, CGRect(x: x - 1, y: y + 3, width: 34, height: 13), fill: index < 0 ? 0xC4DED2 : 0xFCFDF9, edge: 0xAEC6BF, radius: 4)
        g.fill(box(x + 3, y + 7, 24, 5, 1.5), with: .color(c(0xDEEAE5)))
        // A compact display with its baseline inside the desk's immutable map cell.
        panel(g, CGRect(x: x + 2, y: y - 8, width: 14, height: 11), fill: 0x244448, edge: 0x163238, radius: 2)
        g.fill(box(x + 3.5, y - 6.5, 11, 7, 1), with: .color(c(0x527571)))
        for row in 0..<3 { g.fill(box(x + 5, y - 5 + CGFloat(row) * 2, CGFloat(6 - row), 0.7, 0.3), with: .color(c(0xA3C7BA, 0.55))) }
        g.fill(box(x + 7, y + 3, 13, 2.7, 1), with: .color(c(0xAABFB8)))
        g.fill(Path(ellipseIn: CGRect(x: x + 26, y: y + 5, width: 3, height: 3)), with: .color(c(0xD9AD7F)))
    }
    private static func plant(_ g: GraphicsContext, _ x: CGFloat, _ y: CGFloat) {
        g.fill(box(x - 3, y + 2, 7, 6, 2), with: .color(c(0xC6AB8D)))
        for dx in [-2.0, 0, 2] {
            g.fill(Path(ellipseIn: CGRect(x: x + dx - 2, y: y - 5 - abs(dx), width: 5, height: 9)), with: .color(c(dx == 0 ? 0x7D9E82 : 0x4D806C)))
        }
    }
    static func monitorGlow(_ g: GraphicsContext, x: CGFloat, y: CGFloat, frame: Int) {
        let color: UInt32 = frame % 2 == 0 ? 0xA3E4CD : 0x77BFA8
        g.fill(box(x + 3.5, y + 2.5, 11, 7, 1), with: .color(c(0x244B4C)))
        for row in 0..<3 { g.fill(box(x + 5, y + 4 + CGFloat(row) * 2, CGFloat(7 - row), 0.7, 0.3), with: .color(c(color))) }
        g.fill(Path(ellipseIn: CGRect(x: x + 12.5, y: y + 3.5, width: 1, height: 1)), with: .color(c(0xBCEED9)))
    }
    static func hand(_ g: GraphicsContext, x: CGFloat, y: CGFloat, body: PalRGB) {
        g.fill(box(x, y, 3.5, 2.5, 1.2), with: .color(Color(red: body.r, green: body.g, blue: body.b)))
    }
    static func envelope(_ g: GraphicsContext, x: CGFloat, y: CGFloat) {
        panel(g, CGRect(x: x, y: y, width: 10, height: 7), fill: 0xFFFFFF, edge: 0x7AA89E, radius: 2)
        var p = Path(); p.move(to: CGPoint(x: x + 1, y: y + 1)); p.addLine(to: CGPoint(x: x + 5, y: y + 4)); p.addLine(to: CGPoint(x: x + 9, y: y + 1))
        g.stroke(p, with: .color(c(0x539685)), lineWidth: 0.65)
    }
    static func alert(_ g: GraphicsContext, x: CGFloat, y: CGFloat, failed: Bool) {
        let tone: UInt32 = failed ? 0xD9665B : 0xD99A32
        g.fill(Path(ellipseIn: CGRect(x: x - 2, y: y - 1, width: 9, height: 11)), with: .color(c(tone)))
        label(g, "!", x + 1, y + 1, color: 0xFFFFFF)
    }
    static func sign(_ g: GraphicsContext, _ rect: CGRect) {
        panel(g, rect, fill: 0xF5FBF8, edge: 0x8CAE9E, radius: 4)
    }
    static func note(_ g: GraphicsContext, index: Int, x: CGFloat, y: CGFloat) {
        g.fill(box(x, y, 5, 5, 1), with: .color(c(index % 2 == 0 ? 0xE4B969 : 0x8FCFB9)))
        g.fill(box(x + 1, y + 1.8, 3, 0.6, 0.3), with: .color(c(0x223F3E, 0.55)))
    }
    static func confetti(_ g: GraphicsContext, at point: CGPoint, frame: Int) {
        for i in 0..<5 {
            let x = point.x + CGFloat(i - 2) * 3, y = point.y - 24 - CGFloat((frame + i) % 4)
            g.fill(box(x, y, 1.4, 2.4, 0.5), with: .color(c(i % 2 == 0 ? 0x6CA891 : 0xD0A36A)))
        }
    }
}
