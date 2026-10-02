import Foundation
import Testing
@testable import ZenoIslandCore

@Suite("Dictation modes")
struct DictationActivationTests {
    private func release(_ mode: DictationMode, _ heldFor: Double, handsFree: Bool = false) -> DictationActivation.Release {
        DictationActivation.released(mode: mode, heldFor: heldFor, handsFree: handsFree)
    }

    @Test func holdModeAlwaysStopsOnRelease() {
        #expect(release(.hold, 0.1) == .stop)
        #expect(release(.hold, 5) == .stop)
    }

    @Test func automaticModeLatchesAQuickTapAndStopsALongHold() {
        #expect(release(.automatic, 0.15) == .latch)
        #expect(release(.automatic, 0.39) == .latch)
        #expect(release(.automatic, 0.4) == .stop)
        #expect(release(.automatic, 3) == .stop)
    }

    @Test func tapModeNeverStopsOnRelease() {
        #expect(DictationActivation.startsHandsFree(.toggle))
        #expect(release(.toggle, 0.1) == .ignore)
        #expect(release(.toggle, 4) == .ignore)
    }

    @Test func onlyTapModeStartsHandsFree() {
        #expect(!DictationActivation.startsHandsFree(.hold))
        #expect(!DictationActivation.startsHandsFree(.automatic))
    }

    @Test func aHandsFreeDictationIgnoresReleases() {
        for mode in DictationMode.allCases { #expect(release(mode, 2, handsFree: true) == .ignore) }
    }

    @Test func modesHaveWordingAndStableIds() {
        #expect(DictationMode.allCases.map(\.rawValue) == ["hold", "toggle", "automatic"])
        for mode in DictationMode.allCases { #expect(!mode.title.isEmpty && !mode.detail.isEmpty) }
        #expect(DictationOptions().mode == .automatic)
        #expect(DictationOptions().livePreview && DictationOptions().removeFillers)
    }
}

@Suite("Filler words")
struct FillerWordsTests {
    private func clean(_ text: String) -> String { FillerWords.remove(from: text) }

    @Test func dropsFillersInTheMiddle() {
        #expect(clean("I think um we should go") == "I think we should go")
        #expect(clean("So, uh, that works") == "So, that works")
    }

    @Test func dropsTheCommasAroundAFiller() {
        #expect(clean("Well, um, it depends") == "Well, it depends")
    }

    @Test func aFillerAtTheStartPassesTheCapitalOn() {
        #expect(clean("Um, let's start") == "Let's start")
        #expect(clean("Uh the plan is ready") == "The plan is ready")
    }

    @Test func aFillerEndingASentenceMovesItsFullStopBack() {
        #expect(clean("It is fine, um.") == "It is fine.")
        #expect(clean("Is it ready, uh? Yes") == "Is it ready? Yes")
        #expect(clean("Done. Um. Next") == "Done. Next")
    }

    @Test func wordsThatOnlyLookLikeFillersSurvive() {
        #expect(clean("The umbrella hums her song") == "The umbrella hums her song")
        #expect(clean("Under the erm-less sky, uh-huh") == "Under the erm-less sky, uh-huh")
    }

    @Test func anOnlyFillerTextBecomesEmpty() {
        #expect(clean("Um") == "")
        #expect(clean("Uh, um.") == "")
    }

    @Test func textWithoutFillersIsUnchanged() {
        #expect(clean("Nothing to remove here.") == "Nothing to remove here.")
        #expect(clean("") == "")
    }

    @Test func runsOfFillersGoTogether() {
        #expect(clean("I um uh erm think so") == "I think so")
    }
}

@Suite("Live preview")
struct DictationPreviewTests {
    private let second = DictationAudio.sampleRate

    @Test func noPassBeforeASecondOfAudio() {
        #expect(!DictationPreview.shouldDecode(total: second - 1, lastDecoded: 0))
        #expect(DictationPreview.shouldDecode(total: second, lastDecoded: 0))
    }

    @Test func waitsForEnoughNewAudio() {
        #expect(!DictationPreview.shouldDecode(total: 2 * second, lastDecoded: 2 * second - 1_000))
        #expect(DictationPreview.shouldDecode(total: 2 * second, lastDecoded: 2 * second - 6_400))
    }

    @Test func shortTextIsShownAsItIs() {
        #expect(DictationPreview.display("hello there") == "hello there")
    }

    @Test func lineBreaksBecomeSpaces() {
        #expect(DictationPreview.display("one\ntwo\n\nthree") == "one two three")
    }

    @Test func aLongTextKeepsItsNewestWordsAfterAnEllipsis() {
        let text = (1...40).map { "word\($0)" }.joined(separator: " ")
        let shown = DictationPreview.display(text, limit: 40)
        #expect(shown.hasPrefix("…word"))
        #expect(shown.hasSuffix("word40"))
        #expect(shown.count <= 41)
        #expect(!shown.dropFirst().hasPrefix("ord"), "starts at a whole word")
    }
}

@Suite("Dictation settings and preview status")
@MainActor
struct DictationSettingsTests {
    private func settings() -> (IslandSettings, UserDefaults) {
        let name = "zeno.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return (IslandSettings(defaults: defaults), defaults)
    }

    @Test func defaultsAreHoldOrTapWithPreviewAndFillerRemoval() {
        let (s, _) = settings()
        #expect(s.dictationOptions == DictationOptions(mode: .automatic, livePreview: true, removeFillers: true))
    }

    @Test func changesAreSavedAndReloaded() {
        let (s, defaults) = settings()
        s.dictationMode = .toggle
        s.livePreview = false
        s.removeFillers = false
        let again = IslandSettings(defaults: defaults)
        #expect(again.dictationOptions == DictationOptions(mode: .toggle, livePreview: false, removeFillers: false))
    }

    @Test func anUnknownStoredModeFallsBackToTheDefault() {
        let (_, defaults) = settings()
        defaults.set("shouting", forKey: IslandSettings.dictationModeKey)
        #expect(IslandSettings(defaults: defaults).dictationMode == .automatic)
    }

    @Test func previewShowsOnlyWhileListeningAndClearsOnTheNextState() {
        var status = IslandStatus()
        status.setPreview("ignored")
        #expect(status.preview.isEmpty)
        status.apply(.listening)
        status.setPreview("hello there")
        #expect(status.preview == "hello there")
        status.apply(.transcribing)
        #expect(status.preview.isEmpty)
        status.setPreview("late")
        #expect(status.preview.isEmpty, "a late pass cannot reappear after listening ended")
    }

    @Test func handsFreeListeningKeepsTheWordsAndSaysHowToFinish() {
        var status = IslandStatus()
        status.apply(.listening)
        status.setPreview("so far")
        status.apply(.listeningHandsFree)
        #expect(status.kind == .listening && status.showsLevel && status.isBusy)
        #expect(status.detail == "Tap again to finish")
        #expect(status.preview == "so far")
    }
}
