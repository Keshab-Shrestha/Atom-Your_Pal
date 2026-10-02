import Foundation
import Testing
@testable import ZenoIslandCore

@Suite("Look and behaviour settings")
@MainActor
struct LookOptionsTests {
    private func fresh() -> (IslandSettings, UserDefaults, String) {
        let name = "zeno.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        return (IslandSettings(defaults: defaults), defaults, name)
    }

    @Test func defaultsKeepTheOriginalLook() {
        let (settings, _, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        #expect(settings.wispSize == .medium)
        #expect(settings.wispSize.points == 56)
        #expect(settings.wispGlow == .normal)
        #expect(settings.wispLean.degrees == 42)
        #expect(settings.wispWander == .normal)
        #expect(settings.wispNap.seconds == 180)
        #expect(settings.bubbleStay == .seconds2)
        #expect(settings.bubbleOpacity.fill == 0.66)
        #expect(settings.panelSize.size == IslandMetrics().expanded)
        #expect(settings.panelBackground == .glass)
    }

    @Test func choicesSurviveARestart() {
        let (settings, defaults, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        settings.wispSize = .huge
        settings.wispLean = .deep
        settings.wispGlow = .bright
        settings.bubbleStay = .seconds8
        settings.panelSize = .large
        settings.panelBackground = .solid
        let again = IslandSettings(defaults: defaults)
        #expect(again.wispSize == .huge)
        #expect(again.wispLean == .deep)
        #expect(again.wispGlow == .bright)
        #expect(again.bubbleStay == .seconds8)
        #expect(again.panelSize == .large)
        #expect(again.panelBackground == .solid)
    }

    @Test func anUnknownStoredValueFallsBackToTheDefault() {
        let (_, defaults, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        defaults.set(999, forKey: IslandSettings.wispSizeKey)
        defaults.set("big", forKey: IslandSettings.wispGlowKey)
        let settings = IslandSettings(defaults: defaults)
        #expect(settings.wispSize == .medium)
        #expect(settings.wispGlow == .normal)
    }

    @Test func changingOneCountsAsAChange() {
        let (settings, _, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        let before = settings.revision
        settings.bubbleOpacity = .solid
        #expect(settings.revision == before + 1)
    }

    @Test func resetLookRestoresDefaultsButNotTheRest() {
        let (settings, _, name) = fresh()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        settings.wispSize = .large
        settings.wispHideAfter = .seconds15
        settings.panelSize = .compact
        settings.livePreview = false
        settings.soundsEnabled = false
        settings.resetLook()
        #expect(settings.wispSize == .medium)
        #expect(settings.wispHideAfter == .minute1)
        #expect(settings.panelSize == .normal)
        #expect(settings.livePreview == false)
        #expect(settings.soundsEnabled == false)
    }

    @Test func everyChoiceHasAUniqueTitle() {
        func unique<C: SettingsChoice>(_: C.Type) -> Bool { Set(C.allCases.map(\.title)).count == C.allCases.count }
        #expect(unique(WispLean.self))
        #expect(unique(WispSize.self) && unique(WispGlow.self) && unique(WispWander.self) && unique(WispNap.self))
        #expect(unique(BubbleStay.self) && unique(BubbleSize.self) && unique(BubbleOpacity.self))
        #expect(unique(PanelSize.self) && unique(PanelBackground.self))
    }

    @Test func glowAndSizeAreOrdered() {
        let glow = WispGlow.allCases.map(\.strength)
        #expect(glow == glow.sorted())
        let sizes = WispSize.allCases.map(\.points)
        #expect(sizes == sizes.sorted())
        let panels = PanelSize.allCases.map(\.size.width)
        #expect(panels == panels.sorted())
    }

    @Test func stayPutWispNeverFloatsOff() {
        var brain = PetBrain(width: 800, now: 0, tuning: PetBrain.Tuning(wander: .stayPut, nap: .never))
        let start = brain.x
        var t = 0.0
        while t < 120 { t += 0.1; brain.step(to: t) }
        #expect(brain.x == start)
        #expect(brain.mood != .napping) // never naps either
    }

    @Test func livelyWispCoversGroundFasterThanCalm() {
        func distance(_ wander: WispWander) -> Double {
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

    @Test func hidingDepthScalesWithWispsSize() {
        // The feet sit past the edge in proportion to size, so the same share of a bigger Wisp stays hidden.
        let peek = Peek(edge: .left, display: CGRect(x: 0, y: 0, width: 1440, height: 900))
        let scale: CGFloat = 92.0 / 56
        let normal = PeekLayout.feet(for: peek, y: 50)
        let big = PeekLayout.feet(for: peek, y: 50, scale: scale)
        #expect(big.x < normal.x)
        #expect(abs(big.x - normal.x * scale) < 0.001)
    }
}
