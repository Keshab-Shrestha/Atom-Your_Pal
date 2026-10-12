import SwiftUI
import AtomIslandCore

/// ADR-104: the office floor as smooth 2D vector art (it was pixel art, ADR-090). Every shape is drawn in map units
/// (the plan's 16-unit tiles, `OfficeMap`) into a context already scaled to the screen: rounded forms, soft shading,
/// gentle outlines, antialiased at any size. ATOM's own art. The background goes under the pals; the foreground
/// (desks, the table, the sofa's front) over them, so seated pals sit behind their desks.
enum OfficeDrawing {
    private static func hex(_ v: UInt32, _ alpha: Double = 1) -> Color {
        Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255).opacity(alpha)
    }

    private static func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> Path {
        Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: r, style: .continuous)
    }

    private static func disc(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
    }

    /// Light at the top, a little darker below.
    private static func lit(_ top: Color, _ bottom: Color, y: CGFloat, height: CGFloat) -> GraphicsContext.Shading {
        .linearGradient(Gradient(colors: [top, bottom]), startPoint: CGPoint(x: 0, y: y), endPoint: CGPoint(x: 0, y: y + height))
    }

    private static func fill(_ ctx: GraphicsContext, _ path: Path, _ top: UInt32, _ bottom: UInt32, y: CGFloat, height: CGFloat) {
        ctx.fill(path, with: lit(hex(top), hex(bottom), y: y, height: height))
    }

    private static func soften(_ ctx: GraphicsContext, _ path: Path, _ edge: Color, width: CGFloat = 0.6) {
        ctx.stroke(path, with: .color(edge), style: StrokeStyle(lineWidth: width, lineJoin: .round))
    }

    /// A soft contact shadow under a piece of furniture.
    private static func shadow(_ ctx: GraphicsContext, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, strength: Double = 0.2) {
        let rect = CGRect(x: x, y: y, width: w, height: h)
        ctx.fill(Path(ellipseIn: rect), with: .radialGradient(Gradient(colors: [.black.opacity(strength), .black.opacity(0)]),
                                                               center: CGPoint(x: rect.midX, y: rect.midY), startRadius: 0, endRadius: max(w, h) / 2))
    }

    private static let tile = CGFloat(OfficeMap.tile)
    private static let width = CGFloat(OfficeMap.width), height = CGFloat(OfficeMap.height)
    private static let outline = hex(0x2F3440)

    // MARK: - Layers

    static func background(_ ctx: GraphicsContext) {
        floors(ctx)
        wall(ctx)
        partitions(ctx)
        // Chairs behind the desks and the table, so the pals sit in front of them.
        for i in OfficeMap.desks.indices { if let s = OfficeMap.seat(i) { chair(ctx, x: s.point.x, top: s.point.y - 6, half: 8, color: 0xCF8A4A, light: 0xE4A86A) } }
        for i in OfficeMap.meetingSeats.indices { if let s = OfficeMap.seat(OfficeMap.desks.count + i) { chair(ctx, x: s.point.x, top: s.point.y - 4, half: 6, color: 0xCF8A4A, light: 0xE4A86A) } }
        chair(ctx, x: OfficeMap.managerSeat.x, top: OfficeMap.managerSeat.y - 12, half: 11, color: 0x6B3F2A, light: 0x87543A)
        office(ctx)
        lounge(ctx)
        for p in [OfficeMap.Tile(6, 2), OfficeMap.Tile(12, 2), OfficeMap.Tile(0, 12), OfficeMap.Tile(13, 12), OfficeMap.Tile(19, 12)] {
            plant(ctx, CGFloat(p.x) * tile, CGFloat(p.y) * tile)
        }
        printer(ctx, 19 * tile - 3, 2 * tile)
        cooler(ctx, 12 * tile, 8 * tile)
        // The outer walls.
        ctx.fill(Path(CGRect(x: 1, y: 32, width: 2, height: height - 33)), with: .color(hex(0xF6F3EC)))
        ctx.fill(Path(CGRect(x: width - 3, y: 32, width: 2, height: height - 33)), with: .color(hex(0xF6F3EC)))
        ctx.fill(Path(CGRect(x: 1, y: height - 3, width: width - 2, height: 2)), with: .color(hex(0xF6F3EC)))
        ctx.stroke(Path(CGRect(x: 0.5, y: 0.5, width: width - 1, height: height - 1)), with: .color(outline), lineWidth: 1)
    }

    static func foreground(_ ctx: GraphicsContext) {
        for (i, d) in OfficeMap.desks.enumerated() { desk(ctx, CGFloat(d.x) * tile, CGFloat(d.y) * tile, items: i, boss: false) }
        desk(ctx, CGFloat(OfficeMap.managerDesk.x) * tile, CGFloat(OfficeMap.managerDesk.y) * tile, items: -1, boss: true)
        meetingTable(ctx)
        sofaFront(ctx)
    }

    // MARK: - Floors and walls

    private static func floors(_ ctx: GraphicsContext) {
        let area = CGRect(x: 0, y: 32, width: width, height: height - 32)
        ctx.fill(Path(area), with: lit(hex(0x93B09F), hex(0x84A190), y: 32, height: height - 32))
        // Sage tiles: every other one a touch lighter, a soft seam between them.
        var checker = Path(), seams = Path()
        for ty in 2..<OfficeMap.rows { for tx in 0..<OfficeMap.columns {
            let inCarpet = tx <= 5 && ty <= 6, inLounge = tx >= 13 && ty >= 7
            guard !inCarpet, !inLounge else { continue }
            if (tx + ty) % 2 == 0 { checker.addRoundedRect(in: CGRect(x: CGFloat(tx) * tile + 0.4, y: CGFloat(ty) * tile + 0.4, width: tile - 0.8, height: tile - 0.8), cornerSize: CGSize(width: 1.6, height: 1.6)) }
            seams.addRect(CGRect(x: CGFloat(tx) * tile, y: CGFloat(ty) * tile, width: tile, height: tile))
        } }
        ctx.fill(checker, with: .color(.white.opacity(0.07)))
        ctx.stroke(seams, with: .color(hex(0x6F8D7C, 0.45)), lineWidth: 0.5)
        carpet(ctx)
        planks(ctx)
        // The rug under the meeting table.
        ctx.fill(box(24, 160, 96, 46, 7), with: .color(hex(0x8E4A39)))
        ctx.fill(box(26, 162, 92, 42, 5.5), with: lit(hex(0xC0715A), hex(0xAD5C47), y: 162, height: 42))
        ctx.stroke(box(29.5, 165.5, 85, 35, 3.5), with: .color(hex(0xD38D70, 0.85)), lineWidth: 0.8)
        // The wall's shadow on the floor.
        ctx.fill(Path(CGRect(x: 0, y: 32, width: width, height: 7)), with: lit(.black.opacity(0.2), .black.opacity(0), y: 32, height: 7))
    }

    private static func carpet(_ ctx: GraphicsContext) {
        let rect = CGRect(x: 0, y: 32, width: 96, height: 80)
        var inner = ctx
        inner.clip(to: Path(rect))
        inner.fill(Path(rect), with: lit(hex(0x8499B3), hex(0x7489A4), y: 32, height: 80))
        var weave = Path()
        for i in stride(from: -80, to: 100, by: 6) {
            weave.move(to: CGPoint(x: CGFloat(i), y: 32))
            weave.addLine(to: CGPoint(x: CGFloat(i) + 80, y: 112))
        }
        inner.stroke(weave, with: .color(.white.opacity(0.07)), lineWidth: 0.7)
    }

    private static func planks(_ ctx: GraphicsContext) {
        let rect = CGRect(x: 208, y: 112, width: width - 208, height: height - 112)
        var inner = ctx
        inner.clip(to: Path(rect))
        inner.fill(Path(rect), with: lit(hex(0xD0AA78), hex(0xC19A63), y: 112, height: height - 112))
        var lines = Path(), seams = Path()
        for row in 0..<12 {
            let y = 112 + CGFloat(row) * 8
            lines.move(to: CGPoint(x: 208, y: y))
            lines.addLine(to: CGPoint(x: width, y: y))
            var x = 208 + CGFloat(row % 2) * 24
            while x < width {
                seams.move(to: CGPoint(x: x, y: y))
                seams.addLine(to: CGPoint(x: x, y: y + 8))
                x += 48
            }
        }
        inner.stroke(lines, with: .color(hex(0x9A7345, 0.45)), lineWidth: 0.6)
        inner.stroke(seams, with: .color(hex(0x9A7345, 0.35)), lineWidth: 0.5)
    }

    private static func wall(_ ctx: GraphicsContext) {
        ctx.fill(Path(CGRect(x: 0, y: 0, width: width, height: 32)), with: lit(hex(0xF1EDE2), hex(0xE6E0D2), y: 0, height: 32))
        ctx.fill(Path(CGRect(x: 0, y: 0, width: width, height: 3)), with: .color(hex(0x4D5361)))
        ctx.fill(Path(CGRect(x: 0, y: 3, width: width, height: 1.2)), with: .color(hex(0xD6CFBF)))
        ctx.fill(Path(CGRect(x: 0, y: 27, width: width, height: 5)), with: lit(hex(0xBDB3A0), hex(0x9C927D), y: 27, height: 5))
        ctx.fill(Path(CGRect(x: 0, y: 27, width: width, height: 0.8)), with: .color(.white.opacity(0.35)))
        for x in [40, 120, 216, 264] { window(ctx, CGFloat(x)) }
        clock(ctx, 101, 14)
        calendar(ctx, 70, 7)
        // The "Needs you" board: cork in a wooden frame; its notes are drawn live.
        ctx.fill(box(160, 6, 40, 19, 2), with: lit(hex(0x9A6E40), hex(0x7A5230), y: 6, height: 19))
        ctx.fill(box(162, 8, 36, 15, 1.2), with: lit(hex(0xCFA26B), hex(0xBE9059), y: 8, height: 15))
        var speckle = Path()
        for y in stride(from: 9, to: 22, by: 2) { for x in stride(from: 163, to: 197, by: 2) where (x * 3 + y * 7) % 5 == 0 { speckle.addPath(disc(CGFloat(x), CGFloat(y), 0.4)) } }
        ctx.fill(speckle, with: .color(hex(0xA9794A, 0.6)))
    }

    private static func window(_ ctx: GraphicsContext, _ x: CGFloat) {
        ctx.fill(box(x, 6, 24, 17, 2.4), with: lit(hex(0x8E9AA9), hex(0x6F7C8C), y: 6, height: 17))
        let glass = box(x + 1, 7, 22, 15, 1.6)
        ctx.fill(glass, with: lit(hex(0xD3EAF6), hex(0xB1D3E8), y: 7, height: 15))
        var inner = ctx
        inner.clip(to: glass)
        var beams = Path()
        for dx in [CGFloat(4), 14] {
            beams.move(to: CGPoint(x: x + dx, y: 22))
            beams.addLine(to: CGPoint(x: x + dx + 3, y: 22))
            beams.addLine(to: CGPoint(x: x + dx + 8, y: 7))
            beams.addLine(to: CGPoint(x: x + dx + 5, y: 7))
            beams.closeSubpath()
        }
        inner.fill(beams, with: .color(.white.opacity(0.28)))
        ctx.fill(Path(CGRect(x: x + 11, y: 7, width: 2, height: 15)), with: .color(hex(0x8E9AA9)))
        ctx.fill(Path(CGRect(x: x + 1, y: 14, width: 22, height: 1.2)), with: .color(hex(0x8E9AA9)))
        ctx.fill(box(x - 1, 22.6, 26, 2.2, 1.1), with: lit(hex(0xE4DDCC), hex(0xCFC7B5), y: 22.6, height: 2.2))
    }

    private static func clock(_ ctx: GraphicsContext, _ cx: CGFloat, _ cy: CGFloat) {
        ctx.fill(disc(cx, cy + 0.6, 6.6), with: .color(.black.opacity(0.12)))
        ctx.fill(disc(cx, cy, 6.5), with: lit(hex(0xD65B5B), hex(0xB93F3F), y: cy - 6.5, height: 13))
        ctx.fill(disc(cx, cy, 5.2), with: .color(hex(0xFAF8F2)))
        var hands = Path()
        hands.move(to: CGPoint(x: cx, y: cy))
        hands.addLine(to: CGPoint(x: cx, y: cy - 3.8))
        hands.move(to: CGPoint(x: cx, y: cy))
        hands.addLine(to: CGPoint(x: cx + 2.7, y: cy + 0.4))
        ctx.stroke(hands, with: .color(outline), style: StrokeStyle(lineWidth: 0.9, lineCap: .round))
        ctx.fill(disc(cx, cy, 0.7), with: .color(outline))
    }

    private static func calendar(_ ctx: GraphicsContext, _ x: CGFloat, _ y: CGFloat) {
        ctx.fill(box(x, y + 0.6, 12, 15, 1.6), with: .color(.black.opacity(0.1)))
        ctx.fill(box(x, y, 12, 15, 1.6), with: .color(hex(0xF9F6EE)))
        var head = ctx
        head.clip(to: box(x, y, 12, 15, 1.6))
        head.fill(Path(CGRect(x: x, y: y, width: 12, height: 4)), with: lit(hex(0xE0605B), hex(0xCC4A46), y: y, height: 4))
        var dots = Path()
        for r in 0..<3 { for k in 0..<4 { dots.addPath(disc(x + 2.6 + CGFloat(k) * 2.2, y + 6.8 + CGFloat(r) * 3, 0.55)) } }
        ctx.fill(dots, with: .color(hex(0xA3A9B3)))
        soften(ctx, box(x, y, 12, 15, 1.6), hex(0xB9B2A3), width: 0.5)
    }

    /// Thin office walls: Pal's office (a door on its right) and the lounge (doors at its top and its left).
    private static func partitions(_ ctx: GraphicsContext) {
        vertical(ctx, x: 94, from: 32, to: 80)
        vertical(ctx, x: 94, from: 96, to: 112)
        horizontal(ctx, y: 108, from: 0, to: 98)
        horizontal(ctx, y: 108, from: 206, to: 224)
        horizontal(ctx, y: 108, from: 240, to: width)
        vertical(ctx, x: 206, from: 112, to: 160)
        vertical(ctx, x: 206, from: 176, to: height)
    }

    private static func vertical(_ ctx: GraphicsContext, x: CGFloat, from: CGFloat, to: CGFloat) {
        let len = to - from
        ctx.fill(Path(CGRect(x: x + 3.4, y: from + 1, width: 2.6, height: len)),
                 with: .linearGradient(Gradient(colors: [.black.opacity(0.12), .black.opacity(0)]), startPoint: CGPoint(x: x + 3.4, y: 0), endPoint: CGPoint(x: x + 6, y: 0)))
        ctx.fill(box(x, from, 4, len, 1.2), with: .linearGradient(Gradient(colors: [hex(0xF9F7F1), hex(0xE9E4D8), hex(0xD3CCBC)]),
                                                                   startPoint: CGPoint(x: x, y: 0), endPoint: CGPoint(x: x + 4, y: 0)))
        soften(ctx, box(x, from, 4, len, 1.2), hex(0xA59D8C, 0.7), width: 0.4)
    }

    private static func horizontal(_ ctx: GraphicsContext, y: CGFloat, from: CGFloat, to: CGFloat) {
        let len = to - from
        ctx.fill(Path(CGRect(x: from, y: y + 8, width: len, height: 3.5)), with: lit(.black.opacity(0.15), .black.opacity(0), y: y + 8, height: 3.5))
        ctx.fill(box(from, y, len, 9, 1.4), with: .linearGradient(Gradient(stops: [
            .init(color: hex(0xFAF8F2), location: 0), .init(color: hex(0xF1EDE3), location: 0.45), .init(color: hex(0xDDD6C7), location: 0.46), .init(color: hex(0xCFC8B8), location: 1)]),
            startPoint: CGPoint(x: 0, y: y), endPoint: CGPoint(x: 0, y: y + 9)))
        soften(ctx, box(from, y, len, 9, 1.4), hex(0xA59D8C, 0.7), width: 0.4)
    }

    // MARK: - Furniture

    /// An office chair's back, peeking out around the pal in front of it.
    private static func chair(_ ctx: GraphicsContext, x: CGFloat, top: CGFloat, half: CGFloat, color: UInt32, light: UInt32) {
        let back = box(x - half, top, half * 2, 12, 4.2)
        ctx.fill(back, with: lit(hex(light), hex(color), y: top, height: 12))
        soften(ctx, back, hex(0x000000, 0.4), width: 0.7)
        ctx.fill(box(x - half + 2, top + 1.2, half * 2 - 4, 2, 1), with: .color(.white.opacity(0.22)))
    }

    private static func desk(_ ctx: GraphicsContext, _ x: CGFloat, _ y: CGFloat, items: Int, boss: Bool) {
        let top: (UInt32, UInt32) = boss ? (0xAE7A4C, 0x95623A) : (0xE8C189, 0xD6A76A)
        let front: UInt32 = boss ? 0x744A2A : 0xB3814A
        shadow(ctx, x - 1, y + 12, 34, 7, strength: 0.22)
        for lx in [x + 1.2, x + 28.6] { ctx.fill(box(lx, y + 13, 2.2, 4, 0.8), with: .color(hex(0x6E4A25))) }
        ctx.fill(box(x, y, 32, 15, 3), with: lit(hex(front), hex(front).opacity(1), y: y, height: 15))
        ctx.fill(box(x, y + 8.5, 32, 6.5, 2.4), with: lit(hex(front), hex(0x6E4A25), y: y + 8.5, height: 6.5))
        ctx.fill(box(x, y, 32, 11, 3), with: lit(hex(top.0), hex(top.1), y: y, height: 11))
        ctx.fill(Path(CGRect(x: x + 2, y: y + 0.8, width: 28, height: 0.8)), with: .color(.white.opacity(0.3)))
        soften(ctx, box(x, y, 32, 15, 3), hex(0x6E4A25, 0.7), width: 0.6)
        // The monitor (its back: the screen faces the pal), on its stand.
        ctx.fill(box(x + 6.6, y + 1.5, 2.8, 3.5, 0.8), with: .color(hex(0x23272F)))
        ctx.fill(box(x + 4.6, y + 4.6, 6.8, 1.5, 0.75), with: .color(hex(0x23272F)))
        ctx.fill(box(x + 2, y - 8, 12, 10, 2), with: .color(hex(0x23272F)))
        ctx.fill(box(x + 2.8, y - 7.2, 10.4, 8.4, 1.4), with: lit(hex(0x5E6574), hex(0x3A404C), y: y - 7.2, height: 8.4))
        // The keyboard by the pal, then a mug or papers, a little different on each desk.
        ctx.fill(box(x + 15, y + 2, 12, 2.6, 0.9), with: lit(hex(0xD2D6DD), hex(0x9AA1AD), y: y + 2, height: 2.6))
        if items % 2 == 0 { mug(ctx, x + 26, y + 5) }
        if items % 3 != 1 {
            ctx.fill(box(x + 17, y + 5, 7, 4.2, 0.7), with: .color(hex(0xF9F6EE)))
            var lines = Path()
            for ly in [y + 6.4, y + 7.8] { lines.move(to: CGPoint(x: x + 18.2, y: ly)); lines.addLine(to: CGPoint(x: x + 22.4, y: ly)) }
            ctx.stroke(lines, with: .color(hex(0xA3A9B3)), style: StrokeStyle(lineWidth: 0.55, lineCap: .round))
        }
        if boss { ctx.fill(box(x + 12.5, y + 11, 7, 2.4, 1), with: lit(hex(0xF1D173), hex(0xD9B246), y: y + 11, height: 2.4)) }
    }

    private static func mug(_ ctx: GraphicsContext, _ x: CGFloat, _ y: CGFloat) {
        var handle = Path()
        handle.addArc(center: CGPoint(x: x + 3.1, y: y + 2.4), radius: 1.1, startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: false)
        ctx.stroke(handle, with: .color(hex(0xF2F2F2)), lineWidth: 0.7)
        ctx.fill(box(x, y, 3.2, 4.2, 0.9), with: lit(.white, hex(0xDADDE2), y: y, height: 4.2))
        ctx.fill(Path(ellipseIn: CGRect(x: x + 0.3, y: y + 0.1, width: 2.6, height: 1.3)), with: .color(hex(0x6B4429)))
    }

    private static func meetingTable(_ ctx: GraphicsContext) {
        shadow(ctx, 30, 187, 84, 8, strength: 0.22)
        ctx.fill(box(32, 176, 80, 15, 3), with: .color(hex(0xB3814A)))
        ctx.fill(box(32, 184, 80, 7, 2.4), with: lit(hex(0xB3814A), hex(0x6E4A25), y: 184, height: 7))
        ctx.fill(box(32, 176, 80, 10, 3), with: lit(hex(0xE8C189), hex(0xD6A76A), y: 176, height: 10))
        ctx.fill(Path(CGRect(x: 35, y: 176.8, width: 74, height: 0.8)), with: .color(.white.opacity(0.3)))
        soften(ctx, box(32, 176, 80, 15, 3), hex(0x6E4A25, 0.7))
        for x in [CGFloat(44), 74] {
            ctx.fill(box(x, 179, 8, 5, 0.8), with: .color(hex(0xF9F6EE)))
            ctx.stroke(Path { $0.move(to: CGPoint(x: x + 1.5, y: 180.8)); $0.addLine(to: CGPoint(x: x + 6.5, y: 180.8)) },
                       with: .color(hex(0xA3A9B3)), style: StrokeStyle(lineWidth: 0.55, lineCap: .round))
        }
        ctx.fill(box(92, 179, 9, 6, 1.2), with: lit(hex(0x4B5260), hex(0x343944), y: 179, height: 6))
    }

    private static func office(_ ctx: GraphicsContext) {
        // A bookshelf against the wall, with books.
        shadow(ctx, 3, 44, 28, 5, strength: 0.2)
        ctx.fill(box(4, 12, 26, 35, 2.4), with: .color(hex(0x5C3B20)))
        ctx.fill(box(5, 13, 24, 33, 1.6), with: lit(hex(0x84573A), hex(0x6F4527), y: 13, height: 33))
        let books: [UInt32] = [0xC0504D, 0x4F81BD, 0x9BBB59, 0xF2C14E, 0x8064A2, 0x4BACC6]
        for shelf in 0..<3 {
            let y = 14 + CGFloat(shelf) * 11
            var x: CGFloat = 6, i = shelf * 2
            while x < 27 {
                let w = CGFloat(2 + (i % 2)), lift = CGFloat(i % 3 == 0 ? 1 : 0)
                let book = box(x, y + 1 + lift, w, 8 - lift, 0.6)
                ctx.fill(book, with: lit(hex(books[i % books.count]).opacity(1), hex(books[i % books.count]), y: y, height: 9))
                ctx.fill(Path(CGRect(x: x + 0.3, y: y + 1 + lift, width: 0.5, height: 8 - lift)), with: .color(.white.opacity(0.25)))
                x += w + 0.8
                i += 1
            }
            ctx.fill(Path(CGRect(x: 5, y: y + 9, width: 24, height: 1.2)), with: .color(hex(0x4A2F18)))
        }
        plant(ctx, 78, 32)
    }

    private static func lounge(_ ctx: GraphicsContext) {
        // Vending machine.
        shadow(ctx, 208, 123, 16, 5, strength: 0.2)
        ctx.fill(box(209, 96, 14, 30, 2), with: .color(outline))
        ctx.fill(box(210, 97, 12, 28, 1.4), with: lit(hex(0x4A8E9F), hex(0x346E7D), y: 97, height: 28))
        ctx.fill(box(211, 99, 7, 18, 1), with: .color(hex(0x1F3640)))
        let snacks: [UInt32] = [0xF2C14E, 0xE0584C, 0x8BD17C, 0xF29AD8]
        for r in 0..<4 { for k in 0..<2 { ctx.fill(box(212 + CGFloat(k) * 3, 100 + CGFloat(r) * 4, 2.2, 2.4, 0.6), with: .color(hex(snacks[(r + k) % 4]))) } }
        ctx.fill(box(219, 101, 2, 3, 0.7), with: .color(hex(0xBFE9F2)))
        ctx.fill(box(212, 119, 8, 3, 0.8), with: .color(hex(0x1F3640)))
        // Counter, coffee machine, microwave.
        shadow(ctx, 254, 125, 52, 6, strength: 0.2)
        ctx.fill(box(256, 110, 48, 18, 2.2), with: .color(outline))
        ctx.fill(box(257, 117, 46, 10, 1.4), with: lit(hex(0xC9C0AF), hex(0xB1A794), y: 117, height: 10))
        ctx.fill(box(257, 111, 46, 6.4, 1.6), with: lit(hex(0xF4F0E6), hex(0xE2DCCD), y: 111, height: 6.4))
        var doors = Path()
        for x in [272, 288] as [CGFloat] { doors.move(to: CGPoint(x: x, y: 118.5)); doors.addLine(to: CGPoint(x: x, y: 126)) }
        ctx.stroke(doors, with: .color(hex(0x9F9686)), lineWidth: 0.6)
        var knobs = Path()
        for x in [268, 276, 284, 292] as [CGFloat] { knobs.addPath(disc(x, 121.2, 0.55)) }
        ctx.fill(knobs, with: .color(hex(0x6F685C)))
        ctx.fill(box(260, 99, 10, 14, 1.8), with: lit(hex(0x4A4F5C), hex(0x2F333D), y: 99, height: 14))
        ctx.fill(box(262, 102, 6, 3, 0.8), with: .color(hex(0x23262D)))
        ctx.fill(disc(268.2, 101.2, 0.6), with: .color(hex(0xE05050)))
        ctx.fill(box(263, 109, 4, 3, 0.8), with: .color(hex(0xF4F4F4)))
        ctx.fill(box(282, 102, 16, 11, 1.8), with: lit(hex(0xA2A8AF), hex(0x838A92), y: 102, height: 11))
        ctx.fill(box(283, 103, 14, 9, 1.2), with: .color(hex(0xD8DBE0)))
        ctx.fill(box(284, 104, 9, 7, 1), with: lit(hex(0x484E59), hex(0x2F333C), y: 104, height: 7))
        // Fridge.
        shadow(ctx, 303, 139, 17, 6, strength: 0.2)
        ctx.fill(box(304, 94, 15, 49, 2.4), with: .color(hex(0x8C96A0)))
        ctx.fill(box(305, 95, 13, 47, 1.8), with: .linearGradient(Gradient(colors: [hex(0xF1F4F6), hex(0xDDE3E8)]), startPoint: CGPoint(x: 305, y: 0), endPoint: CGPoint(x: 318, y: 0)))
        ctx.fill(Path(CGRect(x: 305, y: 112, width: 13, height: 0.9)), with: .color(hex(0x8C96A0)))
        ctx.fill(box(306, 100, 1.2, 8, 0.6), with: .color(hex(0x8C96A0)))
        ctx.fill(box(306, 116, 1.2, 10, 0.6), with: .color(hex(0x8C96A0)))
        // The sofa's back (its seat and arms are in the foreground), and a coffee table in front of it.
        shadow(ctx, 236, 163, 56, 8, strength: 0.2)
        ctx.fill(box(238, 152, 52, 14, 4), with: .color(hex(0x7E3C2E)))
        ctx.fill(box(239, 153, 50, 12, 3.4), with: lit(hex(0xDC8670), hex(0xB9604B), y: 153, height: 12))
        ctx.fill(box(240, 154.4, 23.2, 9, 3), with: lit(hex(0xDF8D77), hex(0xC9705A), y: 154, height: 9))
        ctx.fill(box(265, 154.4, 23.2, 9, 3), with: lit(hex(0xDF8D77), hex(0xC9705A), y: 154, height: 9))
        shadow(ctx, 242, 186, 44, 7, strength: 0.18)
        ctx.fill(box(244, 180, 40, 10, 3), with: .color(hex(0x6E4A25)))
        ctx.fill(box(245, 181, 38, 6.4, 2.2), with: lit(hex(0xBF9160), hex(0xA8794A), y: 181, height: 6.4))
        ctx.fill(box(254, 182, 3, 3, 0.8), with: .color(hex(0xF4F4F4)))
        ctx.fill(box(270, 182, 3, 3, 0.8), with: .color(hex(0xF2C14E)))
    }

    private static func sofaFront(_ ctx: GraphicsContext) {
        let seat = box(236, 167, 56, 9, 3.4)
        ctx.fill(seat, with: lit(hex(0xE08F79), hex(0xC4644E), y: 167, height: 9))
        soften(ctx, seat, hex(0x7E3C2E, 0.8), width: 0.7)
        for x in [236, 287] as [CGFloat] {
            let arm = box(x, 156, 5, 20, 2.5)
            ctx.fill(arm, with: .linearGradient(Gradient(colors: [hex(0xB9604B), hex(0xA2523F)]), startPoint: CGPoint(x: x, y: 0), endPoint: CGPoint(x: x + 5, y: 0)))
            soften(ctx, arm, hex(0x7E3C2E, 0.8), width: 0.7)
            ctx.fill(box(x + 0.8, 157, 1.4, 6, 0.7), with: .color(.white.opacity(0.2)))
        }
    }

    private static func plant(_ ctx: GraphicsContext, _ x: CGFloat, _ y: CGFloat) {
        shadow(ctx, x + 1, y + 12.5, 14, 4.5, strength: 0.2)
        let leaves: [(CGFloat, CGFloat, Double, UInt32)] = [(8, 4, 0, 0x78C47E), (5.2, 6.4, -38, 0x4F9A5A), (10.8, 6.4, 38, 0x4F9A5A), (3.8, 9, -62, 0x356F40),
                                                            (12.2, 9, 62, 0x356F40), (8, 8, 0, 0x4F9A5A), (6.4, 5, -18, 0x78C47E), (9.6, 5, 18, 0x78C47E)]
        for (dx, dy, turn, color) in leaves {
            let leaf = Path(ellipseIn: CGRect(x: -1.5, y: -3.6, width: 3, height: 7.2))
                .applying(CGAffineTransform(rotationAngle: turn * .pi / 180).concatenating(CGAffineTransform(translationX: x + dx, y: y + dy)))
            ctx.fill(leaf, with: lit(hex(color).opacity(1), hex(color), y: y, height: 12))
            soften(ctx, leaf, hex(0x24502E, 0.35), width: 0.4)
        }
        let pot = Path { p in
            p.move(to: CGPoint(x: x + 3.6, y: y + 9)); p.addLine(to: CGPoint(x: x + 12.4, y: y + 9))
            p.addLine(to: CGPoint(x: x + 11.2, y: y + 14.6)); p.addQuadCurve(to: CGPoint(x: x + 4.8, y: y + 14.6), control: CGPoint(x: x + 8, y: y + 15.6))
            p.closeSubpath()
        }
        ctx.fill(pot, with: lit(hex(0xD27E5C), hex(0xA85A40), y: y + 9, height: 6))
        ctx.fill(box(x + 3.2, y + 8.4, 9.6, 1.8, 0.9), with: .color(hex(0xDE8D6C)))
    }

    private static func printer(_ ctx: GraphicsContext, _ x: CGFloat, _ y: CGFloat) {
        shadow(ctx, x, y + 10, 18, 5, strength: 0.18)
        ctx.fill(box(x + 4, y - 4, 8, 3.4, 0.8), with: .color(hex(0xF9F6EE)))
        ctx.fill(box(x + 1, y - 2, 14, 14, 2.4), with: .color(hex(0x6E7480)))
        ctx.fill(box(x + 2, y - 1, 12, 12, 1.8), with: lit(hex(0xE1E4E8), hex(0xC4C8CE), y: y - 1, height: 12))
        ctx.fill(box(x + 3, y + 1, 10, 2.2, 0.8), with: .color(hex(0x3A3F48)))
        ctx.fill(disc(x + 12, y + 7, 0.7), with: .color(hex(0x5BD67A)))
    }

    private static func cooler(_ ctx: GraphicsContext, _ x: CGFloat, _ y: CGFloat) {
        shadow(ctx, x + 1, y + 11, 14, 5, strength: 0.18)
        ctx.fill(box(x + 4, y - 6, 8, 9.4, 3), with: lit(hex(0xB6E0F5), hex(0x7DB6D6), y: y - 6, height: 9.4))
        ctx.fill(Path(ellipseIn: CGRect(x: x + 5.2, y: y - 4.8, width: 1.6, height: 3.2)), with: .color(.white.opacity(0.5)))
        ctx.fill(box(x + 3, y + 3, 10, 12, 2), with: lit(hex(0xF4F6F8), hex(0xCDD2D8), y: y + 3, height: 12))
        ctx.fill(disc(x + 6.4, y + 7, 0.8), with: .color(hex(0x4F81BD)))
        ctx.fill(disc(x + 9.6, y + 7, 0.8), with: .color(hex(0xC0504D)))
    }

    // MARK: - Small live pieces

    /// A lit monitor: its rim glows and light falls on the desk and on the pal at it. Drawn at (desk x, desk y - 9).
    static func monitorGlow(_ ctx: GraphicsContext, x: CGFloat, y: CGFloat, frame: Int) {
        let strong = frame % 2 == 0
        var g = ctx
        g.translateBy(x: x, y: y)
        let spill = CGRect(x: -2, y: -2, width: 26, height: 26)
        g.fill(Path(ellipseIn: spill), with: .radialGradient(Gradient(colors: [hex(0x8FD3FF, strong ? 0.3 : 0.2), hex(0x8FD3FF, 0)]),
                                                               center: CGPoint(x: 11, y: 8), startRadius: 0, endRadius: 13))
        g.stroke(box(2, 1, 12, 10, 2), with: .color(hex(0x8FD3FF, strong ? 0.95 : 0.65)), lineWidth: 0.9)
        g.fill(disc(4.4, 9.4, 0.7), with: .color(hex(0x5BD67A, strong ? 1 : 0.5)))
    }

    static func envelope(_ ctx: GraphicsContext, x: CGFloat, y: CGFloat) {
        var g = ctx
        g.translateBy(x: x, y: y)
        g.fill(box(0.4, 1, 11, 8, 1.4), with: .color(.black.opacity(0.14)))
        g.fill(box(0, 0, 11, 8, 1.4), with: lit(hex(0xFFFBF0), hex(0xEDE6D4), y: 0, height: 8))
        soften(g, box(0, 0, 11, 8, 1.4), hex(0x6B5B45, 0.8), width: 0.6)
        var flap = Path()
        flap.move(to: CGPoint(x: 0.8, y: 1)); flap.addLine(to: CGPoint(x: 5.5, y: 4.6)); flap.addLine(to: CGPoint(x: 10.2, y: 1))
        g.stroke(flap, with: .color(hex(0xB9AE98)), style: StrokeStyle(lineWidth: 0.6, lineCap: .round, lineJoin: .round))
        g.fill(disc(5.5, 4.6, 0.9), with: .color(hex(0xD9534F)))
    }

    /// The "!" over a pal that needs Keshab (amber) or failed (red).
    static func alert(_ ctx: GraphicsContext, x: CGFloat, y: CGFloat, failed: Bool) {
        var g = ctx
        g.translateBy(x: x, y: y)
        let fillTop = failed ? hex(0xFF8A8A) : hex(0xFFDB5C), fillBottom = failed ? hex(0xE84F4F) : hex(0xF2B100)
        let mark = box(0.6, 0, 3.8, 7.4, 1.9)
        g.fill(mark, with: .linearGradient(Gradient(colors: [fillTop, fillBottom]), startPoint: CGPoint(x: 0, y: 0), endPoint: CGPoint(x: 0, y: 7.4)))
        g.stroke(mark, with: .color(outline), lineWidth: 0.8)
        let dot = disc(2.5, 9.1, 1.2)
        g.fill(dot, with: .color(failed ? hex(0xEE5A5A) : hex(0xF7BE12)))
        g.stroke(dot, with: .color(outline), lineWidth: 0.8)
    }

    /// ADR-094: a blank wooden sign on two legs, the size of `rect` (its words are drawn live).
    static func sign(_ ctx: GraphicsContext, _ rect: CGRect) {
        var g = ctx
        g.translateBy(x: rect.minX, y: rect.minY)
        let w = rect.width, board = rect.height - 4
        for x in [4, w - 6] as [CGFloat] { g.fill(box(x, board - 1, 2, 5, 0.8), with: .color(hex(0x6E4A25))) }
        g.fill(box(0.4, 0.8, w, board, 2), with: .color(.black.opacity(0.14)))
        g.fill(box(0, 0, w, board, 2), with: lit(hex(0xC2915A), hex(0x9C6E3F), y: 0, height: board))
        g.fill(box(1.4, 1.4, w - 2.8, board - 2.8, 1.2), with: lit(hex(0xFBF8F0), hex(0xEFE9DB), y: 1.4, height: board - 2.8))
    }

    /// One note on the "Needs you" board.
    static func note(_ ctx: GraphicsContext, index: Int, x: CGFloat, y: CGFloat) {
        let colors: [UInt32] = [0xFFE27A, 0xFFB86B, 0xF7A8C8, 0xA8E0A0, 0xA8D2F0]
        var g = ctx
        g.translateBy(x: x + 3, y: y + 3)
        g.rotate(by: .degrees(Double(index % 3 - 1) * 3))
        g.translateBy(x: -3, y: -3)
        g.fill(box(0.3, 0.5, 6, 6, 0.8), with: .color(.black.opacity(0.15)))
        g.fill(box(0, 0, 6, 6, 0.8), with: lit(hex(colors[index % colors.count]), hex(colors[index % colors.count]).opacity(0.86), y: 0, height: 6))
        g.stroke(Path { $0.move(to: CGPoint(x: 1.2, y: 3)); $0.addLine(to: CGPoint(x: 4.8, y: 3)) }, with: .color(.black.opacity(0.28)),
                 style: StrokeStyle(lineWidth: 0.5, lineCap: .round))
        g.fill(disc(3, 0.9, 0.6), with: .color(hex(0xD9534F)))
    }

    /// Two little hands on the keyboard, in the pal's colour.
    static func hand(_ ctx: GraphicsContext, x: CGFloat, y: CGFloat, body: PalRGB) {
        let c = Color(red: body.r, green: body.g, blue: body.b)
        let edge = Color(red: body.r * 0.5, green: body.g * 0.5, blue: body.b * 0.5)
        let shape = Path(ellipseIn: CGRect(x: x, y: y, width: 4, height: 3))
        ctx.fill(shape, with: .color(c))
        ctx.stroke(shape, with: .color(edge.opacity(0.8)), lineWidth: 0.5)
    }

    static func confetti(_ ctx: GraphicsContext, at point: CGPoint, frame: Int) {
        let colors: [UInt32] = [0xFFC917, 0x70B8FF, 0xFF8FA8, 0x5CD67A]
        for i in 0..<8 {
            let x = point.x - 12 + CGFloat((i * 7 + frame * 3) % 24), y = point.y - 30 + CGFloat((i * 5 + frame * 2) % 16)
            var g = ctx
            g.translateBy(x: x, y: y)
            g.rotate(by: .degrees(Double((i * 53 + frame * 40) % 180)))
            g.fill(box(-0.8, -0.5, 1.6, 1, 0.4), with: .color(hex(colors[i % colors.count])))
        }
    }
}
