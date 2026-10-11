import CoreGraphics
import Foundation
import Testing
@testable import ZenoIslandCore

/// ADR-090: the office floor's 2D art: the plan and the ways through it, walking, the pixel pals and the office layers.
@Suite("Office floor art")
struct OfficeFloorArtTests {
    func load(_ id: String) throws -> PalDefinition {
        try PalDefinition.decode(Data(contentsOf: PalCharacterTests.file.appendingPathComponent("\(id).json")))
    }

    @Test func everySeatAndLoungeSpotCanBeReachedAroundTheFurniture() {
        let door = OfficeMap.Tile(14, 7)
        var places = (0..<12).compactMap { OfficeMap.seat($0)?.tile }
        places += OfficeMap.loungeSpots
        #expect(places.count == 12 + OfficeMap.loungeSpots.count)
        for place in places {
            let way = OfficeMap.path(from: door, to: place)
            #expect(way.first == door && way.last == place && way.count > 1 || place == door, "\(place)")
            for (a, b) in zip(way, way.dropFirst()) {
                #expect(abs(a.x - b.x) + abs(a.y - b.y) == 1, "one tile at a time")
                #expect(!OfficeMap.wall(between: a, b), "never through a wall")
            }
            #expect(way.dropLast().allSatisfy { OfficeMap.isFree($0) }, "never over furniture: \(place)")
        }
        #expect(OfficeMap.seat(12) == nil, "eight desks and four meeting seats")
    }

    @Test func theLoungeIsEnteredThroughItsDoors() {
        // From a desk in the top row to the sofa: in through the top door or the side door, not through a wall.
        let way = OfficeMap.path(from: OfficeMap.Tile(8, 3), to: OfficeMap.Tile(15, 10))
        let entries = zip(way, way.dropFirst()).filter { a, b in !(a.x >= 13 && a.y >= 7) && (b.x >= 13 && b.y >= 7) }
        #expect(entries.count == 1)
        if let (from, to) = entries.first {
            #expect((from == OfficeMap.Tile(14, 6) && to == OfficeMap.Tile(14, 7)) || (from == OfficeMap.Tile(12, 10) && to == OfficeMap.Tile(13, 10)))
        }
    }

    @Test func aWalkGoesTheWholeWayAtASteadyPace() throws {
        let start = Date(timeIntervalSinceReferenceDate: 1000)
        let from = OfficeMap.lounge(0), to = try #require(OfficeMap.seat(0))
        let walk = OfficeWalk(from: from, to: to, start: start)
        #expect(walk.points.first == from.point && walk.points.last == to.point && walk.points.count > 2)
        #expect(walk.position(at: start).point == from.point && walk.position(at: start).walking)
        let middle = walk.position(at: start.addingTimeInterval(walk.duration / 2))
        #expect(middle.walking && middle.point != from.point && middle.point != to.point)
        let end = walk.position(at: start.addingTimeInterval(walk.duration + 0.1))
        #expect(end.point == to.point && !end.walking)
        #expect(abs(walk.duration - walk.length / OfficeWalk.speed) < 0.001)
    }

    @Test func pixelPalsFollowTheirFiles() throws {
        let sid = try load("sid"), puff = try load("puff"), tinker = try load("tinker")
        let idle = PixelPal.sprite(sid, pose: .idle)
        #expect(idle.width == PixelPal.size && idle.height == PixelPal.size)
        // Its own colour in the middle of the body, a dark outline, clear around.
        #expect(idle[16, 22] == PixelColor(css: sid.colors.body!))
        #expect(idle[0, 0] == .clear)
        #expect(idle.pixels.contains(PixelColor(css: sid.colors.body!)!.shade(0.42)))
        // Eyes in its eye colour, with a glint.
        #expect(idle[11, 18] == PixelColor(css: sid.colors.eyes!) && idle[11, 17] == PixelColor(hex: 0xFFFFFF))
        // Different heads: Puff's long ears and Tinker's antenna reach higher than Sid's pointed ears.
        func top(_ c: PixelCanvas) -> Int { (0..<c.height).first { y in (0..<c.width).contains { c[$0, y].a > 0 } } ?? c.height }
        #expect(top(PixelPal.sprite(puff, pose: .idle)) < top(idle))
        #expect(top(PixelPal.sprite(tinker, pose: .idle)) < top(idle))
        // Every pose is a different frame.
        let frames = PixelPal.Pose.allCases.map { PixelPal.sprite(sid, pose: $0) }
        #expect(Set(frames.map(\.pixels)).count == PixelPal.Pose.allCases.count)
        #expect(PixelPal.sprite(sid, pose: .idle, look: 1) != idle, "the eyes look aside")
    }

    @Test func theOfficeLayersAreTheMapsSizeAndTheForegroundIsMostlyClear() throws {
        let back = OfficeArt.background(), front = OfficeArt.foreground()
        #expect(back.width == OfficeMap.width && back.height == OfficeMap.height && front.width == back.width)
        #expect(back.pixels.allSatisfy { $0.a == 255 }, "the background covers the floor")
        let clear = front.pixels.filter { $0.a == 0 }.count
        #expect(Double(clear) / Double(front.pixels.count) > 0.8, "only the desks, the table and the sofa's front")
        // A desk is drawn over its chair's row, so a seated pal is behind it.
        let desk = OfficeMap.desks[0]
        #expect(front[desk.x * OfficeMap.tile + 20, desk.y * OfficeMap.tile + 5].a == 255)
        let image = try #require(back.cgImage())
        #expect(image.width == OfficeMap.width && image.height == OfficeMap.height)
    }

    @Test func pixelsBlendAndStayInside() {
        var c = PixelCanvas(width: 2, height: 1)
        c.set(0, 0, PixelColor(hex: 0x000000))
        c.set(0, 0, PixelColor(hex: 0xFFFFFF, alpha: 128))
        #expect(c[0, 0].r == 128 && c[0, 0].a == 255)
        c.set(5, 5, PixelColor(hex: 0xFFFFFF))
        #expect(c[5, 5] == .clear && c.pixels.count == 2)
        #expect(PixelColor(css: "#bfe3ef") == PixelColor(hex: 0xBFE3EF) && PixelColor(css: "blue") == nil)
    }
}
