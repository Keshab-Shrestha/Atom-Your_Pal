import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Look and behaviour settings")
@MainActor
struct LookOptionsTests {
    private func fresh() -> (IslandSettings, UserDefaults, String) {
        let name = "atom.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        return (IslandSettings(defaults: defaults), defaults, name)
    }

    @Test func defaultsKeepTheOriginalLook() {
        let (settings, _, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        #expect(settings.palSize == .medium)
        #expect(settings.palSize.points == 56)
        #expect(settings.palWander == .normal)
        #expect(settings.palNap.seconds == 180)
        #expect(settings.bubbleStay == .seconds2)
        #expect(settings.bubbleOpacity.fill == 0.66)
    }

    @Test func choicesSurviveARestart() {
        let (settings, defaults, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        settings.palSize = .huge
        settings.bubbleStay = .seconds8
        let again = IslandSettings(defaults: defaults)
        #expect(again.palSize == .huge)
        #expect(again.bubbleStay == .seconds8)
    }

    @Test func anUnknownStoredValueFallsBackToTheDefault() {
        let (_, defaults, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        defaults.set(999, forKey: IslandSettings.palSizeKey)
        defaults.set("big", forKey: IslandSettings.palWanderKey)
        let settings = IslandSettings(defaults: defaults)
        #expect(settings.palSize == .medium)
        #expect(settings.palWander == .normal)
    }

    @Test func changingOneCountsAsAChange() {
        let (settings, _, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        let before = settings.revision
        settings.bubbleOpacity = .solid
        #expect(settings.revision == before + 1)
    }

    @Test func everyChoiceHasAUniqueTitle() {
        func unique<C: SettingsChoice>(_: C.Type) -> Bool { Set(C.allCases.map(\.title)).count == C.allCases.count }
        #expect(unique(PalSize.self) && unique(PalWander.self) && unique(PalNap.self))
        #expect(unique(BubbleStay.self) && unique(BubbleSize.self) && unique(BubbleOpacity.self))
    }

    @Test func sizesAreOrdered() {
        let sizes = PalSize.allCases.map(\.points)
        #expect(sizes == sizes.sorted())
    }

    @Test func stayPutPalNeverFloatsOff() {
        var brain = PetBrain(width: 800, now: 0, tuning: PetBrain.Tuning(wander: .stayPut, nap: .never))
        let start = brain.x
        var t = 0.0
        while t < 120 { t += 0.1; brain.step(to: t) }
        #expect(brain.x == start)
        #expect(brain.mood != .napping) // never naps either
    }

    @Test func livelyPalCoversGroundFasterThanCalm() {
        func distance(_ wander: PalWander) -> Double {
            var brain = PetBrain(width: 2000, now: 0, tuning: PetBrain.Tuning(wander: wander, nap: .never))
            var t = 0.0, moved = 0.0, last = brain.x
            while t < 90 { t += 0.05; brain.step(to: t); moved += abs(brain.x - last); last = brain.x }
            return moved
        }
        #expect(distance(.lively) > distance(.calm))
    }

    @Test func napTimeFollowsTheSetting() {
        var brain = PetBrain(width: 800, now: 0, tuning: PetBrain.Tuning(wander: .normal, nap: .minute1))
        brain.step(to: 59)
        #expect(brain.mood != .napping)
        brain.step(to: 61)
        #expect(brain.mood == .napping)
    }
}
