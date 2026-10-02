import Testing
@testable import ZenoIslandCore

@Suite("PetBrain")
struct PetBrainTests {
    /// Runs the brain at 60 fps from `from` to `to`, returning every mood it reported.
    private func run(_ brain: inout PetBrain, from: Double, to: Double) -> [PetBrain.Mood] {
        var moods: [PetBrain.Mood] = []
        var t = from
        while t <= to {
            moods.append(brain.step(to: t))
            t += 1.0 / 60
        }
        return moods
    }

    @Test func startsRestingThenFloats() {
        var brain = PetBrain(width: 1000, now: 0)
        #expect(brain.mood == .resting)
        let moods = run(&brain, from: 0, to: 3)
        #expect(moods.contains(.floating))
    }

    @Test func staysOnTheWalkway() {
        var brain = PetBrain(width: 800, now: 0)
        var t = 0.0
        while t < 170 {
            brain.step(to: t)
            #expect(brain.x >= 0 && brain.x <= 800)
            t += 1.0 / 30
        }
    }

    @Test func floatsAtItsSpeed() {
        var brain = PetBrain(width: 2000, now: 0)
        _ = run(&brain, from: 0, to: 2.6) // first rest is 2.5 s
        #expect(brain.mood == .floating)
        let start = brain.x
        _ = run(&brain, from: 2.6 + 1.0 / 60, to: 3.6)
        let moved = abs(brain.x - start)
        // ~38 pt in one second, unless it arrived early.
        #expect(moved <= 38 + 1)
        #expect(brain.mood == .resting || moved > 30)
    }

    @Test func facesTheWayItFloats() {
        var brain = PetBrain(width: 2000, now: 0)
        _ = run(&brain, from: 0, to: 2.6)
        let before = brain.x
        brain.step(to: 2.7)
        let direction = brain.x - before
        #expect(direction != 0)
        #expect((direction > 0) == (brain.facing > 0))
    }

    @Test func tripsAreNeverTiny() {
        var brain = PetBrain(width: 1000, now: 0)
        var t = 0.0
        var tripStart: Double?
        var trips: [Double] = []
        var previous = brain.mood
        while t < 150 {
            let mood = brain.step(to: t)
            if mood == .floating && previous != .floating { tripStart = brain.x }
            if mood == .resting && previous == .floating, let s = tripStart { trips.append(abs(brain.x - s)) }
            previous = mood
            t += 1.0 / 60
        }
        #expect(trips.count >= 3)
        // The first frame of a trip has already moved one step, so allow that.
        #expect(trips.allSatisfy { $0 >= 60 - 1 })
    }

    @Test func napsAfterInactivityAndHoldsStill() {
        var brain = PetBrain(width: 1000, now: 0)
        _ = run(&brain, from: 0, to: 181)
        #expect(brain.mood == .napping)
        let x = brain.x
        _ = run(&brain, from: 181, to: 200)
        #expect(brain.mood == .napping)
        #expect(brain.x == x)
    }

    @Test func activityWakesFromNap() {
        var brain = PetBrain(width: 1000, now: 0)
        _ = run(&brain, from: 0, to: 181)
        brain.update(status: .listening, at: 182)
        #expect(brain.step(to: 182) == .listening)
        brain.update(status: .ready, at: 190)
        #expect(brain.step(to: 190) == .resting)
        // And it does not fall straight back asleep.
        _ = run(&brain, from: 190, to: 250)
        #expect(brain.mood != .napping)
    }

    @Test func pokeWakesFromNap() {
        var brain = PetBrain(width: 1000, now: 0)
        _ = run(&brain, from: 0, to: 181)
        brain.poke(at: 181)
        #expect(brain.step(to: 181.1) == .resting)
    }

    @Test func reactsToEachStateAndHoldsStill() {
        let cases: [(IslandStatus.Kind, PetBrain.Mood)] = [
            (.listening, .listening), (.transcribing, .thinking), (.thinking, .thinking),
            (.speaking, .speaking), (.problem, .worried),
        ]
        for (status, mood) in cases {
            var brain = PetBrain(width: 1000, now: 0)
            _ = run(&brain, from: 0, to: 3) // floating by now
            brain.update(status: status, at: 3)
            let x = brain.x
            let moods = run(&brain, from: 3, to: 6)
            #expect(moods.allSatisfy { $0 == mood }, "\(status)")
            #expect(brain.x == x, "\(status) should hold still")
        }
    }

    @Test func aLongTurnDoesNotNap() {
        var brain = PetBrain(width: 1000, now: 0)
        brain.update(status: .thinking, at: 0)
        _ = run(&brain, from: 0, to: 300)
        #expect(brain.mood == .thinking)
    }

    @Test func noticeAndReadyDoNotInterruptWandering() {
        var brain = PetBrain(width: 1000, now: 0)
        _ = run(&brain, from: 0, to: 3)
        let mood = brain.mood
        brain.update(status: .notice, at: 3)
        brain.update(status: .ready, at: 3)
        #expect(brain.mood == mood)
    }

    @Test func worriedClearsWhenTheProblemDoes() {
        var brain = PetBrain(width: 1000, now: 0)
        brain.update(status: .problem, at: 1)
        #expect(brain.step(to: 1) == .worried)
        brain.update(status: .ready, at: 5)
        #expect(brain.step(to: 5) == .resting)
    }

    @Test func aStalledFrameDoesNotTeleport() {
        var brain = PetBrain(width: 5000, now: 0)
        _ = run(&brain, from: 0, to: 2.6)
        #expect(brain.mood == .floating)
        let x = brain.x
        brain.step(to: 10) // app was paused for 7 s
        #expect(abs(brain.x - x) <= 38 * 0.25 + 0.001)
    }

    @Test func shrinkingTheWalkwayKeepsWispOnIt() {
        var brain = PetBrain(width: 2000, now: 0)
        #expect(brain.x == 1600)
        brain.resize(width: 500)
        #expect(brain.x == 500)
        _ = run(&brain, from: 0, to: 60)
        #expect(brain.x >= 0 && brain.x <= 500)
    }

    @Test func aTinyWalkwayJustRests() {
        var brain = PetBrain(width: 40, now: 0)
        let moods = run(&brain, from: 0, to: 30)
        #expect(!moods.contains(.floating))
    }

    @Test func sameSeedSamePath() {
        var a = PetBrain(width: 1200, now: 0, seed: 7)
        var b = PetBrain(width: 1200, now: 0, seed: 7)
        _ = run(&a, from: 0, to: 40)
        _ = run(&b, from: 0, to: 40)
        #expect(a.x == b.x)
    }
}
