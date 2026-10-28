import CoreGraphics
import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-090: the office floor's 2D art: the plan and the ways through it, walking, and (ADR-104) the pal's parts.
@Suite("Office floor art")
struct OfficeFloorArtTests {
    @Test func loungeActorsStayInsideTheStudioWithoutOverlapping() {
        let points = OfficeMap.loungeSpots.indices.map { OfficeMap.lounge($0).point }
        for (index, point) in points.enumerated() {
            #expect(point.x - 13 >= 208 && point.x + 13 <= CGFloat(OfficeMap.width))
            #expect(point.y - 18 >= 112 && point.y + 11 <= CGFloat(OfficeMap.height))
            for other in points.dropFirst(index + 1) {
                #expect(abs(point.x - other.x) >= 26 || abs(point.y - other.y) >= 28, "characters need distinct space")
            }
        }
    }
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

    /// ADR-104: the drawn pal's parts come from its own file, on the 32-unit grid.
    @Test func palStanceFollowsTheFile() throws {
        let sid = try load("sid"), puff = try load("puff"), tinker = try load("tinker")
        let size = Double(PalStance.size)
        // The body sits in the grid, centred, and the feet sit under it.
        #expect(PalStance.bodyCentre(.idle).x == 16 && PalStance.bodyCentre(.idle).y == 18 && PalStance.bodyHeight(sid) > 0 && PalStance.bodyHeight(sid) < size)
        let idleFeet = PalStance.feet(sid, pose: .idle)
        #expect(idleFeet.count == 2 && idleFeet[0].x < 16 && idleFeet[1].x > 16 && idleFeet[0].y > 18)
        // Different heads: Puff's long ears and Tinker's antenna reach higher than Sid's pointed ears.
        #expect(PalStance.top(puff, pose: .idle) < PalStance.top(sid, pose: .idle))
        #expect(PalStance.top(tinker, pose: .idle) < PalStance.top(sid, pose: .idle))
        #expect(PalStance.top(sid, pose: .idle) >= 0, "nothing is cut off at the top")
        // Poses move the parts: cheering lifts the body and raises the arms, walking lifts one foot.
        #expect(PalStance.bodyCentre(.cheer).y < PalStance.bodyCentre(.idle).y && PalStance.bodyCentre(.sad).y > PalStance.bodyCentre(.idle).y)
        #expect(PalStance.arms(.cheer)[0].hand.y < PalStance.arms(.cheer)[0].shoulder.y)
        #expect(PalStance.arms(.idle)[0].hand.y > PalStance.arms(.idle)[0].shoulder.y)
        #expect(PalStance.feet(sid, pose: .walkA)[0].y < PalStance.feet(sid, pose: .walkA)[1].y)
        let tops = Set(PalStance.Pose.allCases.map { pose in
            PalStance.arms(pose).map { "\($0.hand.x),\($0.hand.y)" }.joined() + "\(PalStance.bodyCentre(pose).y)" + "\(PalStance.feet(sid, pose: pose).map(\.y))"
        })
        #expect(tops.count >= 7, "most poses differ in their parts")
        #expect(PalStance.headNodes(puff, pose: .idle).isEmpty == false)
    }

}

/// ADR-093: the on-screen Pal in 2D art: its moods, how it notices you, and what a press on it does.
@Suite("Pal on screen")
struct PalStanceMotionTests {
    @Test func eachMoodHasItsPose() {
        #expect(PalStanceMotion.frame(mood: .listening, time: 0, micLive: true).pose == .cheer)
        #expect(PalStanceMotion.frame(mood: .carried, time: 0).pose == .cheer)
        #expect(PalStanceMotion.frame(mood: .worried, time: 0).pose == .sad)
        let nap = PalStanceMotion.frame(mood: .napping, time: 0)
        #expect(nap.pose == .blink && nap.sleeping)
        // Thinking glances one way, then the other.
        #expect(PalStanceMotion.frame(mood: .thinking, time: 0.1).look != PalStanceMotion.frame(mood: .thinking, time: 0.9).look)
        // Speaking bobs quickly; resting breathes slowly.
        let speaking = Set((0..<12).map { PalStanceMotion.frame(mood: .speaking, time: Double($0) / 12).pose })
        #expect(speaking == [.idle, .bob])
        #expect(!PalStanceMotion.frame(mood: .resting, time: 0.1).sleeping)
    }

    @Test func itNoticesThePointerAndReacts() {
        #expect(PalStanceMotion.frame(mood: .resting, time: 0.1, gazeX: 2.5).look == 1)
        #expect(PalStanceMotion.frame(mood: .resting, time: 0.1, gazeX: -2.5).look == -1)
        #expect(PalStanceMotion.frame(mood: .resting, time: 0.1, gazeX: 0.3).look == 0)
        #expect(PalStanceMotion.frame(mood: .listening, time: 0.1, gazeX: 2.5).look == 0, "busy: it does not follow the pointer")
        let squish = PalStanceMotion.frame(mood: .resting, time: 0, reaction: .squish, progress: 0.5)
        #expect(squish.squashX > 1 && squish.squashY < 1)
        #expect(PalStanceMotion.frame(mood: .resting, time: 0, reaction: .dizzy, progress: 0.1).wobble != 0)
        let hello = PalStanceMotion.frame(mood: .resting, time: 0, reaction: .hello, progress: 0.5)
        #expect(hello.pose == .cheer && hello.bob < 0)
        #expect(PalStanceMotion.frame(mood: .napping, time: 0, reaction: .yawn, progress: 0.5).pose == .blink)
        // At the end of a reaction it is back to normal.
        let done = PalStanceMotion.frame(mood: .resting, time: 0, reaction: .squish, progress: 1)
        #expect(abs(done.squashX - 1) < 0.001 && abs(done.squashY - 1) < 0.001)
    }

    /// ADR-093: a click opens the ATOM window, a second click (window open and in front) closes it; a double-click's
    /// second press finds it open and leaves it.
    /// ADR-093: while listening Pal waits until the microphone is capturing, then raises its arms with sound bars.
    @Test func speakNowShowsOnPal() {
        let waiting = PalStanceMotion.frame(mood: .listening, time: 0.1)
        #expect(waiting.pose == .idle && !waiting.hearing)
        let live = PalStanceMotion.frame(mood: .listening, time: 0.1, micLive: true)
        #expect(live.pose == .cheer && live.hearing)
        #expect(!PalStanceMotion.frame(mood: .speaking, time: 0.1, micLive: true).hearing, "only while listening")
    }

    @Test func clickOpensAndDoubleClickNeverCloses() {
        #expect(PetClickAction.forPress(clickCount: 1, windowOpen: false) == .open)
        #expect(PetClickAction.forPress(clickCount: 1, windowOpen: true) == .close)
        #expect(PetClickAction.forPress(clickCount: 2, windowOpen: true) == .none)
        #expect(PetClickAction.forPress(clickCount: 2, windowOpen: false) == .open)
    }
}

/// ADR-093: the AI tools found on this Mac, as Settings shows them.
@Suite("AI tools found")
struct AiToolTests {
    @Test func infoCarriesTheToolsFound() throws {
        guard case .info(let info) = try decodeEvent(#"{"type":"info","provider":"claude-plan","model":"claude-sonnet-5-5","providers":[{"id":"claude-plan","name":"Claude (my plan)","available":true,"models":[]}],"tools":[{"id":"codex","name":"Codex","found":true,"signedIn":true,"provider":"codex","note":"Signed in"},{"id":"ollama","name":"Ollama","found":true,"note":"Found: local models are not used by ATOM"},{"bad":1}]}"#) else {
            Issue.record("not info"); return
        }
        #expect(info.tools.map(\.id) == ["codex", "ollama"])
        #expect(info.tools[0].signedIn == true && info.tools[0].provider == "codex")
        #expect(info.tools[1].signedIn == nil && info.tools[1].provider == nil)
        #expect(IslandCommand.toolsScan.line == #"{"type":"tools.scan"}"# + "\n")
    }
}
