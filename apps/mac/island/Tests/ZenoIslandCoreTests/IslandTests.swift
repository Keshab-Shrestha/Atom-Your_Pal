import CoreGraphics
import Testing
@testable import ZenoIslandCore

@Suite("MenuPanelLayout")
struct MenuPanelLayoutTests {
    // The Mac mini's main display: 1920 × 1080 points, menu bar 24 points tall (its bottom at y = 1056;
    // AppKit coordinates grow upward). ZENO's icon is centred at x = 1500.
    // A tall panel-sized card, so clamping to the display is tested at a real panel's size.
    static let tall: IslandMetrics = { var m = IslandMetrics(); m.wide = CGSize(width: 380, height: 460); return m }()
    let layout = MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080), menuBarBottom: 1056, iconMidX: 1500, metrics: Self.tall)

    @Test func thePanelHangsCentredUnderTheIcon() {
        let frame = layout.frame(.wide)
        #expect(frame == CGRect(x: 1310, y: 590, width: 380, height: 460))
        #expect(frame.midX == 1500)
        #expect(frame.maxY == 1050) // 6 below the menu bar: never over it
    }

    @Test func theStatusCardHangsFromTheSamePlace() {
        let compact = layout.frame(.compact), wide = layout.frame(.wide)
        #expect(compact.midX == wide.midX && compact.maxY == wide.maxY)
        #expect(compact.size == CGSize(width: 232, height: 52))
    }

    @Test func anIconNearTheRightEdgeKeepsThePanelOnTheDisplay() {
        let g = MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080), menuBarBottom: 1056, iconMidX: 1900, metrics: Self.tall)
        #expect(g.frame(.wide).maxX == 1912)
    }

    @Test func anIconNearTheLeftEdgeKeepsThePanelOnTheDisplay() {
        let g = MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080), menuBarBottom: 1056, iconMidX: 30, metrics: Self.tall)
        #expect(g.frame(.wide).minX == 8)
    }

    @Test func anUnknownIconPlaceUsesTheTopRight() {
        let g = MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080), menuBarBottom: 1056, metrics: Self.tall)
        #expect(g.frame(.wide).maxX == 1912)
        let nan = MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080), menuBarBottom: 1056, iconMidX: .nan, metrics: Self.tall)
        #expect(nan.frame(.wide) == g.frame(.wide))
    }

    /// ADR-084: the panel grows out of the icon: from its centre, from under the icon when slid sideways, and from the
    /// top-right corner when the icon's place is unknown.
    @Test func thePanelOpensFromTheIcon() {
        #expect(layout.openAnchorX(.wide) == 0.5)
        let right = MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080), menuBarBottom: 1056, iconMidX: 1900, metrics: Self.tall)
        #expect(abs(right.openAnchorX(.wide) - (1900 - 1532) / 380) < 0.0001)
        #expect(MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080), menuBarBottom: 1056, metrics: Self.tall).openAnchorX(.wide) == 1)
        let edge = MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080), menuBarBottom: 1056, iconMidX: 1919, metrics: Self.tall)
        #expect((0...1).contains(edge.openAnchorX(.compact)))
    }

    @Test func followsATallerMenuBar() {
        // A MacBook with a notch: the menu bar is 37 points tall.
        let g = MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1512, height: 982), menuBarBottom: 945, iconMidX: 1200, metrics: Self.tall)
        #expect(g.frame(.wide).maxY == 939)
    }

    @Test func aHiddenMenuBarUsesTheTopOfTheDisplay() {
        let g = MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080), iconMidX: 1500, metrics: Self.tall)
        #expect(g.menuBarBottom == 1080)
        #expect(g.frame(.compact).maxY == 1074)
    }

    @Test func followsADisplayThatIsNotAtTheOrigin() {
        let g = MenuPanelLayout(screen: CGRect(x: 1920, y: 200, width: 2560, height: 1440), menuBarBottom: 1615, iconMidX: 4300, metrics: Self.tall)
        let frame = g.frame(.wide)
        #expect(frame.maxX == 4472 && frame.maxY == 1609)
    }

    @Test func neverLargerThanASmallDisplay() {
        let g = MenuPanelLayout(screen: CGRect(x: 0, y: 0, width: 300, height: 400), menuBarBottom: 376, iconMidX: 200, metrics: Self.tall)
        let wide = g.frame(.wide)
        #expect(wide.width == 284 && wide.minX == 8)
        #expect(wide.height == 362 && wide.minY == 8)
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
        status.apply(.error(RuntimeError(stage: "model", message: "Gemini's daily free limit is used up. Try again after 16:00.", kind: "rate_limit")))
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
