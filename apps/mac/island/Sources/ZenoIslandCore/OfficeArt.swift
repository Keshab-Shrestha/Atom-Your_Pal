import Foundation

/// ADR-090: the office floor in 2D pixel art, drawn here pixel by pixel (ZENO's own art; no tiles from elsewhere):
/// a sage tiled floor, a cream wall with windows, a clock, a calendar and the "Needs you" board, Pal's carpeted office
/// with a bookshelf, wooden desks with monitors, a meeting table on a rug, and a lounge on wooden planks with a
/// counter, coffee machine, fridge, vending machine and sofa. The background goes under the pals; the foreground
/// (desks, the table, the sofa's front) over them, so seated pals sit behind their desks. Pure.
public enum OfficeArt {
    typealias C = PixelColor

    enum P {
        static let outline = C(hex: 0x2F3440)
        static let floor = C(hex: 0x8AA896), grout = C(hex: 0x7B9887), floorHi = C(hex: 0x9CB9A7)
        static let wall = C(hex: 0xECE7DB), wallTop = C(hex: 0x4D5361), trim = C(hex: 0xD6CFBF)
        static let base = C(hex: 0xB5AB97), baseLine = C(hex: 0x8C836F)
        static let carpet = C(hex: 0x7F93AD), carpetDot = C(hex: 0x8C9FB8)
        static let plank = C(hex: 0xC9A26E), plankLine = C(hex: 0xB28A58), plankSeam = C(hex: 0xA27C4C)
        static let partTop = C(hex: 0xF6F3EC), partFace = C(hex: 0xD9D2C3), partLine = C(hex: 0xA59D8C)
        static let deskTop = C(hex: 0xD6A76A), deskHi = C(hex: 0xE8C189), deskFront = C(hex: 0xB3814A), deskEdge = C(hex: 0x6E4A25)
        static let boss = C(hex: 0x95623A), bossHi = C(hex: 0xAE7A4C), bossFront = C(hex: 0x744A2A)
        static let monitor = C(hex: 0x3D4350), monitorHi = C(hex: 0x5A6170), monitorEdge = C(hex: 0x23272F)
        static let chair = C(hex: 0xCF8A4A), chairHi = C(hex: 0xE4A86A), chairEdge = C(hex: 0x7E4F26)
        static let pot = C(hex: 0xC4704F), potDark = C(hex: 0x96533A)
        static let leaf = C(hex: 0x4F9A5A), leafHi = C(hex: 0x78C47E), leafDark = C(hex: 0x356F40)
        static let glass = C(hex: 0xB9D8EC), glassHi = C(hex: 0xDDEFF8), frame = C(hex: 0x7D8A99)
        static let paper = C(hex: 0xF7F4EC), ink = C(hex: 0xA3A9B3)
        static let rug = C(hex: 0xB7654E), rugEdge = C(hex: 0x8E4A39), rugLine = C(hex: 0xD38D70)
        static let sofa = C(hex: 0xC9705A), sofaHi = C(hex: 0xDC8670), sofaDark = C(hex: 0xA2523F)
        static let counter = C(hex: 0xE9E4D8), cabinet = C(hex: 0xBDB4A3)
        static let glow = C(hex: 0x8FD3FF)
    }

    static let t = OfficeMap.tile

    // MARK: - Layers

    public static func background() -> PixelCanvas {
        var c = PixelCanvas(width: OfficeMap.width, height: OfficeMap.height)
        floors(&c)
        wall(&c)
        partitions(&c)
        // Chairs behind the desks and the table, so the pals sit in front of them.
        for i in OfficeMap.desks.indices { if let s = OfficeMap.seat(i) { chair(&c, x: Int(s.point.x), top: Int(s.point.y) - 6, half: 8) } }
        for i in OfficeMap.meetingSeats.indices { if let s = OfficeMap.seat(OfficeMap.desks.count + i) { chair(&c, x: Int(s.point.x), top: Int(s.point.y) - 4, half: 6) } }
        chair(&c, x: Int(OfficeMap.managerSeat.x), top: Int(OfficeMap.managerSeat.y) - 12, half: 11, color: C(hex: 0x6B3F2A), hi: C(hex: 0x87543A))
        office(&c)
        lounge(&c)
        for p in [OfficeMap.Tile(6, 2), OfficeMap.Tile(12, 2), OfficeMap.Tile(0, 12), OfficeMap.Tile(13, 12), OfficeMap.Tile(19, 12)] { plant(&c, p.x * t, p.y * t) }
        printer(&c, 19 * t - 3, 2 * t)
        cooler(&c, 12 * t, 8 * t)
        // The outer walls.
        c.rect(0, 0, 1, c.height, P.outline)
        c.rect(c.width - 1, 0, 1, c.height, P.outline)
        c.rect(0, c.height - 1, c.width, 1, P.outline)
        c.rect(1, 32, 2, c.height - 33, P.partTop)
        c.rect(c.width - 3, 32, 2, c.height - 33, P.partTop)
        c.rect(1, c.height - 3, c.width - 2, 2, P.partTop)
        return c
    }

    public static func foreground() -> PixelCanvas {
        var c = PixelCanvas(width: OfficeMap.width, height: OfficeMap.height)
        for (i, d) in OfficeMap.desks.enumerated() { desk(&c, d.x * t, d.y * t, items: i) }
        desk(&c, OfficeMap.managerDesk.x * t, OfficeMap.managerDesk.y * t, items: -1, boss: true)
        meetingTable(&c)
        sofaFront(&c)
        return c
    }

    // MARK: - Floors and walls

    static func floors(_ c: inout PixelCanvas) {
        for y in 32..<c.height {
            for x in 0..<c.width {
                let tx = x / t, ty = y / t
                if tx <= 5 && ty <= 6 {
                    c.set(x, y, (x % 4 == 0 && y % 4 == (ty % 2) * 2) ? P.carpetDot : P.carpet)
                } else if tx >= 13 && ty >= 7 {
                    let row = (y - 112) / 8
                    let seam = (x + (row % 2) * 24) % 48 == 0
                    c.set(x, y, y % 8 == 0 ? P.plankLine : seam ? P.plankSeam : P.plank)
                } else {
                    c.set(x, y, x % t == 0 || y % t == 0 ? P.grout : P.floor)
                }
            }
        }
        // A little light where four sage tiles meet.
        for ty in 3..<OfficeMap.rows { for tx in 1..<OfficeMap.columns where (tx + ty) % 2 == 0 && !(tx <= 6 && ty <= 6) && !(tx >= 13 && ty >= 7) {
            c.rect(tx * t - 1, ty * t, 3, 1, P.floorHi)
            c.rect(tx * t, ty * t - 1, 1, 3, P.floorHi)
        } }
        // The rug under the meeting table.
        c.rect(24, 160, 96, 46, P.rugEdge)
        c.rect(26, 162, 92, 42, P.rug)
        c.frame(29, 165, 86, 36, P.rugLine)
        // The wall's shadow on the floor.
        c.rect(0, 32, c.width, 2, C(hex: 0x000000, alpha: 40))
    }

    static func wall(_ c: inout PixelCanvas) {
        c.rect(0, 0, c.width, 32, P.wall)
        c.rect(0, 0, c.width, 3, P.wallTop)
        c.rect(0, 3, c.width, 1, P.trim)
        c.rect(0, 27, c.width, 3, P.base)
        c.rect(0, 30, c.width, 2, P.baseLine)
        for x in [40, 120, 216, 264] { window(&c, x) }
        clock(&c, 101, 14)
        calendar(&c, 70, 7)
        // The "Needs you" board: cork in a wooden frame; its notes are drawn live.
        c.rect(160, 6, 40, 19, C(hex: 0x8A6338))
        c.rect(162, 8, 36, 15, C(hex: 0xC89A62))
        for y in 8..<23 { for x in 162..<198 where (x * 3 + y * 7) % 11 == 0 { c.set(x, y, C(hex: 0xB4864F)) } }
    }

    static func window(_ c: inout PixelCanvas, _ x: Int) {
        c.rect(x, 6, 24, 17, P.frame)
        c.rect(x + 1, 7, 22, 15, P.glass)
        c.rect(x + 1, 7, 22, 3, P.glassHi)
        for i in 0..<6 { c.set(x + 4 + i, 18 - i, C(hex: 0xFFFFFF, alpha: 150)); c.set(x + 14 + i, 20 - i, C(hex: 0xFFFFFF, alpha: 110)) }
        c.rect(x + 11, 7, 2, 15, P.frame)
        c.rect(x + 1, 14, 22, 1, P.frame)
        c.rect(x - 1, 23, 26, 2, P.trim)
    }

    static func clock(_ c: inout PixelCanvas, _ cx: Int, _ cy: Int) {
        for y in -6...6 { for x in -6...6 {
            let d = x * x + y * y
            if d <= 36 { c.set(cx + x, cy + y, d >= 26 ? C(hex: 0xC84B4B) : C(hex: 0xFAF8F2)) }
        } }
        c.rect(cx, cy - 4, 1, 5, P.outline)
        c.rect(cx, cy, 3, 1, P.outline)
    }

    static func calendar(_ c: inout PixelCanvas, _ x: Int, _ y: Int) {
        c.rect(x, y, 12, 15, P.paper)
        c.frame(x, y, 12, 15, C(hex: 0xB9B2A3))
        c.rect(x, y, 12, 4, C(hex: 0xD9534F))
        for r in 0..<3 { for k in 0..<4 { c.set(x + 2 + k * 2 + (k > 1 ? 1 : 0), y + 6 + r * 3, P.ink) } }
    }

    /// Thin office walls: Pal's office (a door on its right) and the lounge (doors at its top and its left).
    static func partitions(_ c: inout PixelCanvas) {
        vertical(&c, x: 94, from: 32, to: 80)
        vertical(&c, x: 94, from: 96, to: 112)
        horizontal(&c, y: 108, from: 0, to: 98)
        horizontal(&c, y: 108, from: 206, to: 224)
        horizontal(&c, y: 108, from: 240, to: c.width)
        vertical(&c, x: 206, from: 112, to: 160)
        vertical(&c, x: 206, from: 176, to: c.height)
    }

    static func vertical(_ c: inout PixelCanvas, x: Int, from: Int, to: Int) {
        c.rect(x, from, 1, to - from, P.partLine)
        c.rect(x + 1, from, 2, to - from, P.partTop)
        c.rect(x + 3, from, 1, to - from, P.partFace)
        c.rect(x, to - 1, 4, 1, P.partLine)
    }

    static func horizontal(_ c: inout PixelCanvas, y: Int, from: Int, to: Int) {
        c.rect(from, y, to - from, 4, P.partTop)
        c.rect(from, y + 4, to - from, 3, P.partFace)
        c.rect(from, y + 7, to - from, 1, P.partLine)
        c.rect(from, y + 8, to - from, 1, C(hex: 0x000000, alpha: 35))
    }

    // MARK: - Furniture

    /// An office chair's back, peeking out around the pal in front of it.
    static func chair(_ c: inout PixelCanvas, x: Int, top: Int, half: Int, color: C = P.chair, hi: C = P.chairHi) {
        c.rect(x - half, top + 1, half * 2, 11, P.chairEdge)
        c.rect(x - half + 1, top, half * 2 - 2, 1, P.chairEdge)
        c.rect(x - half + 1, top + 1, half * 2 - 2, 10, color)
        c.rect(x - half + 1, top + 8, half * 2 - 2, 1, color.shade(0.85))
        c.rect(x - half + 2, top + 1, half * 2 - 4, 2, hi)
    }

    static func desk(_ c: inout PixelCanvas, _ x: Int, _ y: Int, items: Int, boss: Bool = false) {
        let top = boss ? P.boss : P.deskTop, hi = boss ? P.bossHi : P.deskHi, front = boss ? P.bossFront : P.deskFront
        c.rect(x, y, 32, 15, P.deskEdge)
        c.rect(x + 1, y + 1, 30, 9, top)
        c.rect(x + 1, y + 1, 30, 1, hi)
        c.rect(x + 1, y + 10, 30, 4, front)
        c.rect(x + 1, y + 15, 2, 1, P.deskEdge)
        c.rect(x + 29, y + 15, 2, 1, P.deskEdge)
        // The monitor (its back: the screen faces the pal), on its stand.
        c.rect(x + 2, y - 8, 12, 10, P.monitorEdge)
        c.rect(x + 3, y - 7, 10, 8, P.monitor)
        c.rect(x + 3, y - 7, 10, 1, P.monitorHi)
        c.rect(x + 7, y + 2, 2, 3, P.monitorEdge)
        c.rect(x + 5, y + 5, 6, 1, P.monitorEdge)
        // The keyboard by the pal, then a mug or papers, a little different on each desk.
        c.rect(x + 15, y + 2, 12, 2, C(hex: 0x9AA1AD))
        c.rect(x + 15, y + 2, 12, 1, C(hex: 0xC3C8D0))
        if items % 2 == 0 {
            c.rect(x + 26, y + 5, 3, 4, C(hex: 0xF2F2F2))
            c.set(x + 29, y + 6, C(hex: 0xF2F2F2))
            c.rect(x + 26, y + 5, 3, 1, C(hex: 0x6B4429))
        }
        if items % 3 != 1 {
            c.rect(x + 17, y + 5, 7, 4, P.paper)
            c.rect(x + 18, y + 6, 5, 1, P.ink)
            c.rect(x + 18, y + 8, 4, 1, P.ink)
        }
        if boss { c.rect(x + 13, y + 11, 6, 2, C(hex: 0xE8C25A)) }
    }

    static func meetingTable(_ c: inout PixelCanvas) {
        c.rect(32, 176, 80, 15, P.deskEdge)
        c.rect(33, 177, 78, 9, P.deskTop)
        c.rect(33, 177, 78, 1, P.deskHi)
        c.rect(33, 186, 78, 4, P.deskFront)
        for x in [44, 74] { c.rect(x, 179, 8, 5, P.paper); c.rect(x + 1, 180, 6, 1, P.ink) }
        c.rect(92, 179, 9, 6, C(hex: 0x3D4350))
    }

    static func office(_ c: inout PixelCanvas) {
        // A bookshelf against the wall, with books.
        c.rect(4, 12, 26, 35, C(hex: 0x5C3B20))
        c.rect(5, 13, 24, 33, C(hex: 0x7A4E2C))
        let books: [UInt32] = [0xC0504D, 0x4F81BD, 0x9BBB59, 0xF2C14E, 0x8064A2, 0x4BACC6]
        for shelf in 0..<3 {
            let y = 14 + shelf * 11
            c.rect(5, y + 9, 24, 1, C(hex: 0x5C3B20))
            var x = 6
            var i = shelf * 2
            while x < 27 {
                let w = 2 + (i % 2)
                c.rect(x, y + 1 + (i % 3 == 0 ? 1 : 0), w, 8 - (i % 3 == 0 ? 1 : 0), C(hex: books[i % books.count]))
                x += w + 1
                i += 1
            }
        }
        plant(&c, 78, 32)
    }

    static func lounge(_ c: inout PixelCanvas) {
        // Vending machine.
        c.rect(209, 96, 14, 30, P.outline)
        c.rect(210, 97, 12, 28, C(hex: 0x3F7F8F))
        c.rect(211, 99, 7, 18, C(hex: 0x1F3640))
        let snacks: [UInt32] = [0xF2C14E, 0xE0584C, 0x8BD17C, 0xF29AD8]
        for r in 0..<4 { for k in 0..<2 { c.rect(212 + k * 3, 100 + r * 4, 2, 2, C(hex: snacks[(r + k) % 4])) } }
        c.rect(219, 101, 2, 3, C(hex: 0xBFE9F2))
        c.rect(212, 119, 8, 3, C(hex: 0x1F3640))
        // Counter, coffee machine, microwave.
        c.rect(256, 110, 48, 18, P.outline)
        c.rect(257, 111, 46, 6, P.counter)
        c.rect(257, 117, 46, 10, P.cabinet)
        for x in [272, 288] { c.rect(x, 118, 1, 9, C(hex: 0x9F9686)) }
        for x in [268, 276, 284, 292] { c.set(x, 121, C(hex: 0x6F685C)) }
        c.rect(260, 99, 10, 14, C(hex: 0x363A44))
        c.rect(262, 102, 6, 3, C(hex: 0x23262D))
        c.set(268, 101, C(hex: 0xE05050))
        c.rect(263, 109, 4, 3, C(hex: 0xF2F2F2))
        c.rect(282, 102, 16, 11, C(hex: 0x8A9098))
        c.rect(283, 103, 14, 9, C(hex: 0xCFD3D8))
        c.rect(284, 104, 9, 7, C(hex: 0x3A3F48))
        // Fridge.
        c.rect(304, 94, 15, 49, C(hex: 0x8C96A0))
        c.rect(305, 95, 13, 47, C(hex: 0xE6EBEF))
        c.rect(305, 112, 13, 1, C(hex: 0x8C96A0))
        c.rect(306, 100, 1, 8, C(hex: 0x8C96A0))
        c.rect(306, 116, 1, 10, C(hex: 0x8C96A0))
        // The sofa's back (its seat and arms are in the foreground), and a coffee table in front of it.
        // Two cushions, one per seat.
        c.rect(238, 152, 52, 14, P.outline)
        c.rect(239, 153, 50, 12, P.sofaDark)
        c.rect(240, 154, 48, 9, P.sofa)
        c.rect(240, 154, 48, 2, P.sofaHi)
        c.rect(264, 155, 1, 8, P.sofaDark)
        c.rect(244, 180, 40, 10, P.deskEdge)
        c.rect(245, 181, 38, 6, C(hex: 0xA8794A))
        c.rect(245, 181, 38, 1, C(hex: 0xBF9160))
        c.rect(254, 182, 3, 3, C(hex: 0xF2F2F2))
        c.rect(270, 182, 3, 3, C(hex: 0xF2C14E))
    }

    static func sofaFront(_ c: inout PixelCanvas) {
        c.rect(236, 167, 56, 9, P.outline)
        c.rect(237, 168, 54, 3, P.sofaHi)
        c.rect(237, 171, 54, 4, P.sofa)
        c.rect(236, 156, 5, 20, P.outline)
        c.rect(237, 157, 3, 18, P.sofaDark)
        c.rect(287, 156, 5, 20, P.outline)
        c.rect(288, 157, 3, 18, P.sofaDark)
    }

    static func plant(_ c: inout PixelCanvas, _ x: Int, _ y: Int) {
        c.rect(x + 4, y + 9, 8, 6, P.potDark)
        c.rect(x + 5, y + 9, 6, 5, P.pot)
        c.rect(x + 4, y + 9, 8, 1, P.potDark)
        let leaves: [(Int, Int, C)] = [(7, 1, P.leafHi), (4, 3, P.leaf), (10, 3, P.leaf), (6, 4, P.leafHi), (9, 5, P.leafDark),
                                       (3, 6, P.leafDark), (11, 6, P.leaf), (7, 6, P.leaf), (5, 7, P.leaf), (9, 7, P.leafHi)]
        for (dx, dy, col) in leaves { c.rect(x + dx, y + dy, 2, 3, col) }
    }

    static func printer(_ c: inout PixelCanvas, _ x: Int, _ y: Int) {
        c.rect(x + 1, y - 2, 14, 14, C(hex: 0x6E7480))
        c.rect(x + 2, y - 1, 12, 12, C(hex: 0xD3D6DB))
        c.rect(x + 3, y + 1, 10, 2, C(hex: 0x3A3F48))
        c.rect(x + 4, y - 4, 8, 3, P.paper)
        c.set(x + 12, y + 7, C(hex: 0x5BD67A))
    }

    static func cooler(_ c: inout PixelCanvas, _ x: Int, _ y: Int) {
        c.rect(x + 4, y - 6, 8, 9, C(hex: 0x6FA9C9))
        c.rect(x + 5, y - 5, 6, 7, C(hex: 0xA8D8F0))
        c.rect(x + 3, y + 3, 10, 12, C(hex: 0x9AA1AD))
        c.rect(x + 4, y + 4, 8, 10, C(hex: 0xF0F2F4))
        c.set(x + 6, y + 7, C(hex: 0x4F81BD))
        c.set(x + 9, y + 7, C(hex: 0xC0504D))
    }

    // MARK: - Small live pieces

    /// A lit monitor: its rim glows and light falls on the desk and on the pal at it. Drawn at (desk x, desk y - 9).
    public static func monitorGlow(frame: Int) -> PixelCanvas {
        var c = PixelCanvas(width: 20, height: 20)
        let strong: UInt8 = frame % 2 == 0 ? 230 : 170
        c.rect(2, 1, 12, 1, P.glow.with(alpha: strong))
        c.rect(13, 1, 1, 10, P.glow.with(alpha: strong))
        c.rect(14, 0, 5, 12, P.glow.with(alpha: 34))
        c.rect(2, 11, 16, 6, P.glow.with(alpha: 26))
        c.set(4, 9, C(hex: 0x5BD67A, alpha: frame % 2 == 0 ? 255 : 120))
        return c
    }

    public static func envelope() -> PixelCanvas {
        var c = PixelCanvas(width: 11, height: 8)
        c.rect(0, 0, 11, 8, C(hex: 0x6B5B45))
        c.rect(1, 1, 9, 6, C(hex: 0xF7F3E8))
        for i in 0..<5 { c.set(1 + i, 1 + i / 2, C(hex: 0xB9AE98)); c.set(9 - i, 1 + i / 2, C(hex: 0xB9AE98)) }
        c.set(5, 4, C(hex: 0xD9534F))
        return c
    }

    /// The "!" over a pal that needs Keshab (amber) or failed (red).
    public static func alert(failed: Bool) -> PixelCanvas {
        var c = PixelCanvas(width: 5, height: 10)
        let fill = failed ? C(hex: 0xFF6B6B) : C(hex: 0xFFCA16)
        c.rect(1, 0, 3, 7, P.outline)
        c.rect(1, 8, 3, 2, P.outline)
        c.rect(2, 1, 1, 5, fill)
        c.set(2, 8, fill)
        return c
    }

    /// ADR-094: a blank wooden sign on two legs, the size of `rect` (its words are drawn live).
    public static func sign(_ rect: CGRect) -> PixelCanvas {
        let w = Int(rect.width), h = Int(rect.height), board = h - 4
        var c = PixelCanvas(width: w, height: h)
        for x in [4, w - 6] { c.rect(x, board - 1, 2, 5, P.deskEdge) }
        c.rect(0, 0, w, board, P.outline)
        c.rect(1, 1, w - 2, board - 2, P.deskFront)
        c.rect(2, 2, w - 4, board - 4, P.paper)
        c.rect(2, board - 3, w - 4, 1, P.trim)
        return c
    }

    /// One note on the "Needs you" board.
    public static func note(_ index: Int) -> PixelCanvas {
        let colors: [UInt32] = [0xFFE27A, 0xFFB86B, 0xF7A8C8, 0xA8E0A0, 0xA8D2F0]
        var c = PixelCanvas(width: 6, height: 6)
        let col = C(hex: colors[index % colors.count])
        c.rect(0, 0, 6, 6, col)
        c.rect(0, 5, 6, 1, col.shade(0.82))
        c.rect(1, 2, 4, 1, col.shade(0.7))
        c.set(2, 0, C(hex: 0xD9534F))
        return c
    }
}
