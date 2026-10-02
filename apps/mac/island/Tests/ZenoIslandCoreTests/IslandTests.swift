import CoreGraphics
import Testing
@testable import ZenoIslandCore

@Suite("IslandGeometry")
struct IslandGeometryTests {
    // The Mac mini's main display: 1920 × 1080 points, menu bar 24 points tall (its bottom at y = 1056;
    // AppKit coordinates grow upward).
    let geometry = IslandGeometry(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080), menuBarBottom: 1056)

    @Test func shownSitsAtTheLeftEdgeJustBelowTheMenuBar() {
        let frame = geometry.frame(.compact, visible: true)
        #expect(frame == CGRect(x: 8, y: 996, width: 232, height: 52))
        #expect(frame.maxY == 1048) // 8 below the menu bar: never over it
    }

    @Test func hiddenIsEntirelyPastTheLeftEdge() {
        let frame = geometry.frame(.compact, visible: false)
        #expect(frame == CGRect(x: -232, y: 996, width: 232, height: 52))
        #expect(frame.maxX <= geometry.screen.minX)
    }

    @Test func slidingIsAStraightHorizontalMove() {
        for presentation in [IslandGeometry.Presentation.compact, .expanded] {
            let hidden = geometry.frame(presentation, visible: false), shown = geometry.frame(presentation, visible: true)
            #expect(hidden.minY == shown.minY && hidden.size == shown.size)
        }
    }

    @Test func expandedGrowsDownAndRightFromTheSameCorner() {
        let compact = geometry.frame(.compact, visible: true), expanded = geometry.frame(.expanded, visible: true)
        #expect(expanded.minX == compact.minX && expanded.maxY == compact.maxY)
        #expect(expanded.size == CGSize(width: 380, height: 460))
    }

    @Test func followsATallerMenuBar() {
        // A MacBook with a notch: the menu bar is 37 points tall.
        let g = IslandGeometry(screen: CGRect(x: 0, y: 0, width: 1512, height: 982), menuBarBottom: 945)
        #expect(g.frame(.compact, visible: true).maxY == 937)
        #expect(!g.inTrigger(CGPoint(x: 0, y: 950))) // in the menu bar
        #expect(g.inTrigger(CGPoint(x: 0, y: 940)))
    }

    @Test func aHiddenMenuBarUsesTheTopOfTheDisplay() {
        let g = IslandGeometry(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080))
        #expect(g.menuBarBottom == 1080)
        #expect(g.frame(.compact, visible: true).maxY == 1072)
    }

    @Test func followsADisplayThatIsNotAtTheOrigin() {
        // The menu bar display to the right of and higher than another one.
        let g = IslandGeometry(screen: CGRect(x: 1920, y: 200, width: 2560, height: 1440), menuBarBottom: 1615)
        #expect(g.frame(.compact, visible: true) == CGRect(x: 1928, y: 1555, width: 232, height: 52))
        #expect(g.frame(.compact, visible: false).maxX == 1920)
        #expect(g.inTrigger(CGPoint(x: 1920, y: 1600)))
        #expect(!g.inTrigger(CGPoint(x: 0, y: 1000))) // the left edge of the other display
    }

    @Test func neverLargerThanASmallDisplay() {
        let g = IslandGeometry(screen: CGRect(x: 0, y: 0, width: 300, height: 400), menuBarBottom: 376)
        let expanded = g.frame(.expanded, visible: true)
        #expect(expanded.width == 284 && expanded.minX == 8)
        #expect(expanded.height == 360 && expanded.minY == 8)
    }

    @Test func triggerIsTheLeftEdgeJustBelowTheMenuBar() {
        #expect(geometry.inTrigger(CGPoint(x: 0, y: 1040)))
        #expect(geometry.inTrigger(CGPoint(x: 2, y: 917)))   // 139 below the menu bar: the end of the band
        #expect(!geometry.inTrigger(CGPoint(x: 0, y: 915)))  // below the band
        #expect(!geometry.inTrigger(CGPoint(x: 3, y: 1040)))  // not pressed against the edge
        #expect(!geometry.inTrigger(CGPoint(x: 0, y: 1056)))  // the menu bar itself (Apple menu)
        #expect(!geometry.inTrigger(CGPoint(x: 0, y: 1079)))  // the top-left corner (hot corner)
        #expect(!geometry.inTrigger(CGPoint(x: 0, y: 500)))   // further down the left edge
    }

    @Test func keepZoneCoversTheCardAndTheStripToTheEdgeButNotTheMenuBar() {
        #expect(geometry.inKeepZone(CGPoint(x: 120, y: 1020), .compact)) // over the card
        #expect(geometry.inKeepZone(CGPoint(x: 3, y: 1020), .compact))   // between it and the edge
        #expect(geometry.inKeepZone(CGPoint(x: 260, y: 980), .compact))  // within the margin
        #expect(!geometry.inKeepZone(CGPoint(x: 300, y: 1020), .compact)) // beyond the margin
        #expect(!geometry.inKeepZone(CGPoint(x: 120, y: 900), .compact)) // well below it
        #expect(!geometry.inKeepZone(CGPoint(x: 20, y: 1060), .compact))  // in the menu bar: the Apple menu
        #expect(geometry.inKeepZone(CGPoint(x: 300, y: 700), .expanded)) // the expanded view is larger
    }
}

@Suite("HoverController")
struct HoverControllerTests {
    typealias Output = HoverController.Output

    @Test func restingInTheStripRevealsAfterTheDelay() {
        var hover = HoverController(revealDelay: 0.25, hideDelay: 0.5)
        #expect(hover.update(inTrigger: true, inKeepZone: true, now: 10) == Output(visible: false, recheckAt: 10.25))
        #expect(hover.update(inTrigger: true, inKeepZone: true, now: 10.1) == Output(visible: false, recheckAt: 10.25))
        #expect(hover.update(inTrigger: true, inKeepZone: true, now: 10.25) == Output(visible: true, recheckAt: nil))
        #expect(hover.phase == .shown)
    }

    @Test func passingThroughTheStripDoesNotReveal() {
        var hover = HoverController()
        _ = hover.update(inTrigger: true, inKeepZone: true, now: 0)
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 0.1) == Output(visible: false, recheckAt: nil))
        #expect(hover.phase == .hidden)
        // Coming back starts the delay again.
        #expect(hover.update(inTrigger: true, inKeepZone: true, now: 0.2) == Output(visible: false, recheckAt: 0.45))
    }

    @Test func staysOpenWhileThePointerIsOverIt() {
        var hover = HoverController()
        _ = hover.update(inTrigger: true, inKeepZone: true, now: 0)
        _ = hover.update(inTrigger: true, inKeepZone: true, now: 0.3)
        // Moving down onto the pill: out of the strip but in the keep zone.
        #expect(hover.update(inTrigger: false, inKeepZone: true, now: 5) == Output(visible: true, recheckAt: nil))
        #expect(hover.update(inTrigger: false, inKeepZone: true, now: 60) == Output(visible: true, recheckAt: nil))
    }

    @Test func hidesAfterTheDelayOnceThePointerLeaves() {
        var hover = HoverController(revealDelay: 0.25, hideDelay: 0.5)
        _ = hover.update(inTrigger: true, inKeepZone: true, now: 0)
        _ = hover.update(inTrigger: true, inKeepZone: true, now: 0.25)
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 1) == Output(visible: true, recheckAt: 1.5))
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 1.2) == Output(visible: true, recheckAt: 1.5))
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 1.5) == Output(visible: false, recheckAt: nil))
        #expect(hover.phase == .hidden)
    }

    @Test func comingBackBeforeTheDelayKeepsItOpen() {
        var hover = HoverController(revealDelay: 0.25, hideDelay: 0.5)
        _ = hover.update(inTrigger: true, inKeepZone: true, now: 0)
        _ = hover.update(inTrigger: true, inKeepZone: true, now: 0.25)
        _ = hover.update(inTrigger: false, inKeepZone: false, now: 1)
        #expect(hover.update(inTrigger: false, inKeepZone: true, now: 1.3) == Output(visible: true, recheckAt: nil))
        // Leaving again starts a fresh delay.
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 2) == Output(visible: true, recheckAt: 2.5))
    }

    @Test func heldStaysVisibleWhereverThePointerIs() {
        var hover = HoverController(revealDelay: 0.25, hideDelay: 0.5)
        hover.held = true
        #expect(hover.visible)
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 0) == Output(visible: true, recheckAt: nil))
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 100) == Output(visible: true, recheckAt: nil))
        // Released with the pointer away: hides after the usual delay.
        hover.held = false
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 101) == Output(visible: true, recheckAt: 101.5))
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 101.5) == Output(visible: false, recheckAt: nil))
    }

    @Test func lingerShowsUntilItEndsThenHidesAsUsual() {
        var hover = HoverController(revealDelay: 0.25, hideDelay: 0.5)
        hover.linger(until: 12.5)
        #expect(hover.visible)
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 10) == Output(visible: true, recheckAt: 12.5))
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 12.5) == Output(visible: true, recheckAt: 13))
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 13) == Output(visible: false, recheckAt: nil))
    }

    @Test func lingerEndingWithThePointerOverItStaysOpen() {
        var hover = HoverController()
        hover.linger(until: 2)
        #expect(hover.update(inTrigger: false, inKeepZone: true, now: 3) == Output(visible: true, recheckAt: nil))
    }

    @Test func aLaterLingerExtendsAnEarlierOne() {
        var hover = HoverController()
        hover.linger(until: 8)
        hover.linger(until: 5) // shorter: ignored
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 6) == Output(visible: true, recheckAt: 8))
    }

    @Test func dismissHidesAtOnceUnlessThePointerIsOverIt() {
        var hover = HoverController()
        hover.linger(until: 100)
        hover.dismiss()
        #expect(hover.update(inTrigger: false, inKeepZone: false, now: 1) == Output(visible: false, recheckAt: nil))
        hover.linger(until: 100)
        hover.dismiss()
        #expect(hover.update(inTrigger: false, inKeepZone: true, now: 1) == Output(visible: true, recheckAt: nil))
    }
}

@Suite("IslandStatus")
struct IslandStatusTests {
    let ready = IslandEvent.ready(ReadyInfo(protocolVersion: 1, provider: "gemini", model: "gemini-3.6-flash", microphone: ":Webcam", voice: true))

    @Test func followsATurn() {
        var status = IslandStatus()
        #expect(status.kind == .starting && status.title == "Starting")
        status.apply(ready)
        #expect(status.kind == .ready && status.title == "Ready" && status.detail == "Gemini 3.6 Flash")
        #expect(!status.isBusy && !status.showsLevel)

        status.apply(.state(.listening))
        #expect(status.title == "Listening" && status.isBusy && status.showsLevel)
        status.apply(.micSilent(microphone: ":Webcam"))
        #expect(status.detail == "Can't hear you. Check the microphone")
        status.apply(.state(.transcribing))
        #expect(status.title == "Transcribing" && !status.showsLevel)
        status.apply(.state(.thinking))
        #expect(status.title == "Thinking" && status.detail == "Gemini 3.6 Flash")
        status.apply(.micLevel(0.4)) // only the meter uses levels
        #expect(status.title == "Thinking")
        status.apply(.state(.speaking))
        #expect(status.title == "Speaking" && status.isBusy)
        status.apply(.state(.idle))
        #expect(status.kind == .ready && status.detail == "Gemini 3.6 Flash")
    }

    @Test func aProblemStaysAfterTheTurnUntilSeen() {
        var status = IslandStatus()
        status.apply(ready)
        status.apply(.state(.thinking))
        status.apply(.error(RuntimeError(stage: "model", message: "Gemini's daily free limit is used up. Try again after 16:00.", kind: "rate_limit", retryable: true)))
        #expect(status.kind == .problem && status.title == "Model limit reached")
        #expect(status.detail == "Gemini's daily free limit is used up")
        status.apply(.state(.idle))
        #expect(status.kind == .problem && status.needsAttention)
        status.acknowledge()
        #expect(status.kind == .ready)
    }

    @Test func noticesExplainWhatToDo() {
        var status = IslandStatus()
        status.apply(ready)
        status.apply(.notice(kind: "too_short", message: "…"))
        #expect(status.title == "Too short" && status.detail == "Hold the keys while you speak" && status.kind == .notice)
        status.apply(.notice(kind: "no_speech", message: "…"))
        #expect(status.title == "Didn't catch that")
        status.apply(.notice(kind: "something_new", message: "…"))
        #expect(status.title == "Nothing sent" && status.detail == "")
    }

    @Test func errorTitlesNameTheCause() {
        func title(_ stage: String, _ kind: String? = nil) -> String {
            IslandStatus.errorTitle(RuntimeError(stage: stage, message: "x", kind: kind))
        }
        #expect(title("model", "auth") == "Model key rejected")
        #expect(title("model", "unavailable") == "Model unreachable")
        #expect(title("model", "timeout") == "Model too slow")
        #expect(title("model") == "Model error")
        #expect(title("microphone") == "Microphone problem")
        #expect(title("speech") == "Couldn't speak")
        #expect(title("protocol") == "Something went wrong")
    }

    @Test func supervisorProblemsStayUntilZenoRecovers() {
        var status = IslandStatus()
        status.apply(RuntimeSupervisor.Status.restarting(after: 1))
        #expect(status.title == "Restarting" && status.kind == .starting)
        status.apply(RuntimeSupervisor.Status.configError("GEMINI_API_KEY is missing. Add it to .env."))
        #expect(status.title == "Check settings" && status.detail == "GEMINI_API_KEY is missing")
        status.acknowledge() // seeing it does not make it go away
        #expect(status.kind == .problem)
        status.apply(ready)
        #expect(status.kind == .ready)
    }

    @Test func shortKeepsTheFirstSentenceOnOneLine() {
        #expect(IslandStatus.short("No microphone. Plug one in.") == "No microphone")
        #expect(IslandStatus.short("Version 3.6 failed") == "Version 3.6 failed") // a dot inside a word is not a sentence end
        #expect(IslandStatus.short("first line\nsecond") == "first line")
        let long = IslandStatus.short(String(repeating: "a", count: 60))
        #expect(long.count == 44 && long.hasSuffix("…"))
    }

    @Test func modelNamesReadNaturally() {
        #expect(IslandStatus.displayName(provider: "gemini", model: "gemini-3.6-flash") == "Gemini 3.6 Flash")
        #expect(IslandStatus.displayName(provider: "gemini", model: "gemini-3.5-flash-lite") == "Gemini 3.5 Flash Lite")
        #expect(IslandStatus.displayName(provider: "anthropic", model: "claude-haiku-4-5-20251001") == "Claude Haiku 4.5")
        #expect(IslandStatus.displayName(provider: "anthropic", model: "claude-sonnet-5") == "Claude Sonnet 5")
        #expect(IslandStatus.displayName(provider: "gemini", model: "") == "Gemini")
    }
}

@Suite("LevelMeter")
struct LevelMeterTests {
    @Test func usesADecibelScale() {
        let meter = LevelMeter(floorDb: -50)
        #expect(meter.scaled(0) == 0)
        #expect(meter.scaled(1) == 1)
        #expect(meter.scaled(2) == 1) // clipped
        #expect(abs(meter.scaled(0.1) - 0.6) < 1e-9)          // -20 dB
        #expect(abs(meter.scaled(0.003_162_3) - 0) < 0.001)   // -50 dB: the floor
        #expect(meter.scaled(0.001) == 0)                     // below the floor
    }

    @Test func risesAtOnceAndFallsGently() {
        var meter = LevelMeter(bars: 4, fall: 0.5, floorDb: -50)
        meter.add(1)
        #expect(meter.value == 1)
        meter.add(0)
        #expect(meter.value == 0.5)
        meter.add(0)
        #expect(meter.value == 0.25)
        meter.add(1)
        #expect(meter.value == 1)
        #expect(meter.history == [1, 0.5, 0.25, 1])
    }

    @Test func historyKeepsTheNewestLevelsAndResetClearsThem() {
        var meter = LevelMeter(bars: 3, fall: 1)
        for peak in [1.0, 0, 1, 0.1] { meter.add(peak) }
        #expect(meter.history.count == 3)
        #expect(meter.history.last.map { abs($0 - 0.6) < 1e-9 } == true)
        meter.reset()
        #expect(meter.value == 0 && meter.history == [0, 0, 0])
    }
}
