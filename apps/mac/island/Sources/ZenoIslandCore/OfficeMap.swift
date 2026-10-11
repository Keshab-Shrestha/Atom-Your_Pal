import CoreGraphics
import Foundation

/// ADR-090: the office floor's plan in 16-pixel tiles (20 × 13): the wall along the top, Pal's office at the top left,
/// eight desks, a meeting table with four more seats, and the lounge at the bottom right. Says where each pal sits or
/// stands, and finds the way between two places (breadth-first over the free tiles, through doors). Pure.
public enum OfficeMap {
    public static let tile = 16
    public static let columns = 20
    public static let rows = 13
    public static var width: Int { columns * tile }
    public static var height: Int { rows * tile }

    public struct Tile: Hashable, Sendable {
        public var x: Int
        public var y: Int
        public init(_ x: Int, _ y: Int) {
            self.x = x
            self.y = y
        }
    }

    /// Where a pal is drawn: the sprite's centre in map pixels, and whether a desk or sofa hides its lower half.
    public struct Place: Equatable, Sendable {
        public var tile: Tile
        public var point: CGPoint
        public var seated: Bool

        public init(tile: Tile, point: CGPoint, seated: Bool) {
            self.tile = tile
            self.point = point
            self.seated = seated
        }
    }

    // MARK: - Furniture

    /// Each desk's left tile; a desk is two tiles wide and its chair is behind it (above, on screen).
    public static let desks: [Tile] = [Tile(7, 4), Tile(10, 4), Tile(13, 4), Tile(16, 4), Tile(1, 9), Tile(4, 9), Tile(7, 9), Tile(10, 9)]
    /// Pal's desk, in its office.
    public static let managerDesk = Tile(2, 4)
    /// The meeting table's tiles; four more seats behind it.
    public static let meetingTable = (2...6).map { Tile($0, 11) }
    public static let meetingSeats = (3...6).map { Tile($0, 10) }
    /// Two seats on the sofa (its middle tile is walked through, not sat on).
    public static let sofa = [Tile(15, 10), Tile(17, 10)]
    /// Where idle pals stand or sit in the lounge, in the order they take them.
    public static let loungeSpots: [Tile] = [Tile(15, 10), Tile(17, 10), Tile(15, 8), Tile(17, 8), Tile(18, 11), Tile(14, 11),
                                             Tile(16, 12), Tile(13, 9), Tile(18, 9), Tile(14, 12)]

    /// Tiles nobody walks on: furniture, and Pal's office (Pal stays at its desk).
    public static let blocked: Set<Tile> = {
        var tiles = Set<Tile>()
        for x in 0...5 { for y in 2...6 { tiles.insert(Tile(x, y)) } }
        for d in desks { tiles.insert(d); tiles.insert(Tile(d.x + 1, d.y)) }
        meetingTable.forEach { tiles.insert($0) }
        // Plants, the water cooler, the printer; in the lounge the vending machine, counter, fridge and coffee table.
        [Tile(6, 2), Tile(12, 2), Tile(19, 2), Tile(12, 8), Tile(0, 12), Tile(13, 7), Tile(16, 7), Tile(17, 7), Tile(18, 7),
         Tile(19, 7), Tile(19, 8), Tile(15, 11), Tile(16, 11), Tile(17, 11), Tile(13, 12), Tile(19, 12)].forEach { tiles.insert($0) }
        return tiles
    }()

    /// The lounge's walls: along its top (a door at column 14) and its left side (a door at row 10).
    static func wall(between a: Tile, _ b: Tile) -> Bool {
        let (top, bottom) = a.y < b.y ? (a, b) : (b, a)
        if a.x == b.x, top.y == 6, bottom.y == 7, (13...19).contains(a.x), a.x != 14 { return true }
        let (left, right) = a.x < b.x ? (a, b) : (b, a)
        if a.y == b.y, left.x == 12, right.x == 13, (7...12).contains(a.y), a.y != 10 { return true }
        return false
    }

    public static func isFree(_ t: Tile) -> Bool {
        t.x >= 0 && t.x < columns && t.y >= 2 && t.y < rows && !blocked.contains(t)
    }

    // MARK: - Places

    /// A seat by its number: the eight desks, then the meeting table. Nil past those.
    public static func seat(_ index: Int) -> Place? {
        if desks.indices.contains(index) {
            let d = desks[index]
            // Centred a little right of the desk's middle, clear of the monitor on its left.
            return Place(tile: Tile(d.x + 1, d.y - 1), point: CGPoint(x: d.x * tile + 21, y: d.y * tile - 6), seated: true)
        }
        let m = index - desks.count
        guard meetingSeats.indices.contains(m) else { return nil }
        let s = meetingSeats[m]
        return Place(tile: s, point: CGPoint(x: s.x * tile + 8, y: (s.y + 1) * tile - 6), seated: true)
    }

    public static var managerSeat: CGPoint { CGPoint(x: managerDesk.x * tile + 21, y: managerDesk.y * tile - 6) }

    /// A spot in the lounge by its number; past the last, the spots are used again a little to one side.
    public static func lounge(_ index: Int) -> Place {
        let spot = loungeSpots[index % loungeSpots.count]
        let nudge = CGFloat(index / loungeSpots.count) * 6
        if sofa.contains(spot) {
            return Place(tile: spot, point: CGPoint(x: CGFloat(spot.x * tile + 8) + nudge, y: CGFloat(spot.y * tile)), seated: true)
        }
        return standing(spot, nudge: nudge)
    }

    /// Standing on a tile: feet on its lower part.
    public static func standing(_ t: Tile, nudge: CGFloat = 0) -> Place {
        Place(tile: t, point: CGPoint(x: CGFloat(t.x * tile + 8) + nudge, y: CGFloat(t.y * tile + 5)), seated: false)
    }

    // MARK: - The way

    /// The tiles from `start` to `goal`, both included, around furniture and through doors; [start, goal] if none.
    public static func path(from start: Tile, to goal: Tile) -> [Tile] {
        if start == goal { return [start] }
        var previous: [Tile: Tile] = [start: start]
        var queue = [start]
        var head = 0
        while head < queue.count {
            let here = queue[head]
            head += 1
            if here == goal { break }
            for next in [Tile(here.x + 1, here.y), Tile(here.x - 1, here.y), Tile(here.x, here.y + 1), Tile(here.x, here.y - 1)]
            where previous[next] == nil && (isFree(next) || next == goal) && !wall(between: here, next) {
                previous[next] = here
                queue.append(next)
            }
        }
        guard previous[goal] != nil else { return [start, goal] }
        var way = [goal]
        while let last = way.last, last != start, let before = previous[last] { way.append(before) }
        return way.reversed()
    }
}

/// ADR-090: a pal walking from one place to another along the way between them, at a steady pace. Pure.
public struct OfficeWalk: Equatable, Sendable {
    /// Map pixels, from where it starts to where it ends.
    public var points: [CGPoint]
    public var start: Date
    /// Map pixels a second.
    public static let speed: Double = 40

    public init(from: OfficeMap.Place, to: OfficeMap.Place, start: Date) {
        let tiles = OfficeMap.path(from: from.tile, to: to.tile)
        let middle = tiles.dropFirst().dropLast().map { OfficeMap.standing($0).point }
        points = [from.point] + middle + [to.point]
        self.start = start
    }

    public var length: Double {
        zip(points, points.dropFirst()).reduce(0) { $0 + hypot($1.1.x - $1.0.x, $1.1.y - $1.0.y) }
    }

    public var duration: TimeInterval { length / Self.speed }

    /// Where it is at `date`, whether it is still walking, and which way it is heading (-1 left, 1 right, 0 neither).
    public func position(at date: Date) -> (point: CGPoint, walking: Bool, heading: Int) {
        var left = max(0, date.timeIntervalSince(start)) * Self.speed
        for (a, b) in zip(points, points.dropFirst()) {
            let step = hypot(b.x - a.x, b.y - a.y)
            if left <= step, step > 0 {
                let t = left / step
                let heading = abs(b.x - a.x) < 0.5 ? 0 : (b.x > a.x ? 1 : -1)
                return (CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t), true, heading)
            }
            left -= step
        }
        return (points.last ?? .zero, false, 0)
    }
}
