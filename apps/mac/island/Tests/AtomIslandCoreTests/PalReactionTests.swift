import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Pal notices you (ADR-073)")
struct PalReactionTests {
    // MARK: Gaze

    @Test func eyesTurnTowardThePointer() {
        let right = PalGaze.offset(dx: 200, dy: 0, mood: .resting)
        #expect(right.x > 0)
        #expect(abs(right.y) < 0.001)
        // Screen y points up; design y points down, so a pointer above Pal looks up (negative y).
        let above = PalGaze.offset(dx: 0, dy: 200, mood: .floating)
        #expect(above.y < 0)
        #expect(abs(above.x) < 0.001)
    }

    @Test func eyesMoveOnlyAFewPoints() {
        let far = PalGaze.offset(dx: 390, dy: -50, mood: .resting)
        #expect(hypot(far.x, far.y) <= PalGaze.maxOffset + 0.001)
        // Very close: a smaller glance, so the eyes do not swing when the pointer is on Pal.
        let close = PalGaze.offset(dx: 10, dy: 0, mood: .resting)
        #expect(close.x > 0)
        #expect(close.x < far.x)
    }

    @Test func pointerOutOfRangeIsIgnored() {
        let out = PalGaze.offset(dx: PalGaze.range + 1, dy: 0, mood: .resting)
        #expect(out.x == 0 && out.y == 0)
    }

    @Test(arguments: [PetBrain.Mood.napping, .listening, .thinking, .speaking, .worried, .carried])
    func onlyAnIdleAwakePalLooks(mood: PetBrain.Mood) {
        let gaze = PalGaze.offset(dx: 100, dy: 100, mood: mood)
        #expect(gaze.x == 0 && gaze.y == 0)
    }

    // MARK: Clicks

    @Test func clicksGiveASquishAndThreeMakeItDizzy() {
        #expect(PalReaction.forClick(count: 1) == .squish)
        #expect(PalReaction.forClick(count: 2) == .squish)
        #expect(PalReaction.forClick(count: 3) == .dizzy)
        #expect(PalReaction.forClick(count: 5) == .dizzy)
    }

    // MARK: Playing a reaction

    @Test func aReactionRunsForItsDurationThenEnds() {
        var player = PalReactionPlayer()
        player.start(.squish, at: 10, mood: .resting, reduceMotion: false)
        let mid = player.active(at: 10 + PalReaction.squish.duration / 2, mood: .resting)
        #expect(mid?.reaction == .squish)
        #expect(abs((mid?.progress ?? 0) - 0.5) < 0.001)
        #expect(player.active(at: 10 + PalReaction.squish.duration + 0.01, mood: .resting) == nil)
        #expect(PalReaction.dizzy.duration == 2)
    }

    @Test(arguments: [PetBrain.Mood.listening, .thinking, .speaking, .worried, .carried])
    func zenoStateReplacesAReactionAtOnce(mood: PetBrain.Mood) {
        var player = PalReactionPlayer()
        player.start(.dizzy, at: 0, mood: .resting, reduceMotion: false)
        #expect(player.active(at: 0.5, mood: mood) == nil)
        // And it does not come back when ZENO is idle again.
        #expect(player.active(at: 0.6, mood: .resting) == nil)
    }

    @Test func noReactionStartsWhileAtomIsBusy() {
        var player = PalReactionPlayer()
        player.start(.squish, at: 0, mood: .listening, reduceMotion: false)
        #expect(player.active(at: 0.1, mood: .resting) == nil)
    }

    @Test func aNewReactionReplacesTheOldOne() {
        var player = PalReactionPlayer()
        player.start(.squish, at: 0, mood: .resting, reduceMotion: false)
        player.start(.dizzy, at: 0.1, mood: .resting, reduceMotion: false)
        #expect(player.active(at: 0.2, mood: .resting)?.reaction == .dizzy)
    }

    @Test func reduceMotionDropsSquashWobbleAndBounce() {
        for reaction in [PalReaction.squish, .dizzy, .hello] {
            var player = PalReactionPlayer()
            player.start(reaction, at: 0, mood: .resting, reduceMotion: true)
            #expect(player.active(at: 0.05, mood: .resting) == nil, "\(reaction)")
        }
        // A yawn is only the face, so it stays.
        var player = PalReactionPlayer()
        player.start(.yawn, at: 0, mood: .napping, reduceMotion: true)
        #expect(player.active(at: 0.05, mood: .napping)?.reaction == .yawn)
    }

    @Test func aYawnPlaysAsPalFallsAsleep() {
        var player = PalReactionPlayer()
        player.start(.yawn, at: 0, mood: .napping, reduceMotion: false)
        #expect(player.active(at: 0.5, mood: .napping)?.reaction == .yawn)
    }
}

@Suite("Reacts to you setting (ADR-073)")
@MainActor
struct PalReactsSettingTests {
    @Test func onByDefaultAndKept() {
        let name = "zeno.test.\(UUID().uuidString)"
        defer { UserDefaults().removePersistentDomain(forName: name) }
        let defaults = UserDefaults(suiteName: name)!
        let settings = IslandSettings(defaults: defaults)
        #expect(settings.palReacts)
        settings.palReacts = false
        #expect(IslandSettings(defaults: defaults).palReacts == false)
    }
}
