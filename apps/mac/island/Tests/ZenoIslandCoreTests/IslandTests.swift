import CoreGraphics
import Testing
@testable import ZenoIslandCore

@Suite("IslandGeometry")
struct IslandGeometryTests {
    // The Mac mini's main display: 1920 × 1080, menu bar at the top (y = 1080 in AppKit coordinates).
    let geometry = IslandGeometry(screen: CGRect(x: 0, y: 0, width: 1920, height: 1080))

    @Test func hiddenIsJustAboveTheTopEdge() {
        let frame = geometry.frame(.compact, visible: false)
        #expect(frame == CGRect(x: 860, y: 1080, width: 200, height: 36))
        #expect(frame.minY >= geometry.screen.maxY) // nothing of it on the display
    }

    @Test func shownHangsFromTheTopEdge() {
        let frame = geometry.frame(.compact, visible: true)
        #expect(frame == CGRect(x: 860, y: 1044, width: 200, height: 36))
        #expect(frame.maxY == geometry.screen.maxY)
        #expect(frame.midX == geometry.screen.midX)
    }

    @Test func expandedIsCentredAndHangsFromTheTop() {
        let frame = geometry.frame(.expanded, visible: true)
        #expect(frame == CGRect(x: 750, y: 780, width: 420, height: 300))
        #expect(geometry.frame(.expanded, visible: false).minY == 1080)
    }

    @Test func slidingIsAStraightVerticalMove() {
        for presentation in [IslandGeometry.Presentation.compact, .expanded] {
            let hidden = geometry.frame(presentation, visible: false), shown = geometry.frame(presentation, visible: true)
            #expect(hidden.minX == shown.minX && hidden.size == shown.size)
        }
    }

    @Test func followsADisplayThatIsNotAtTheOrigin() {
        // Menu bar display to the right of and higher than another one.
        let g = IslandGeometry(screen: CGRect(x: 1920, y: 200, width: 2560, height: 1440))
        #expect(g.frame(.compact, visible: true) == CGRect(x: 3100, y: 1604, width: 200, height: 36))
        #expect(g.frame(.compact, visible: false).minY == 1640)
        #expect(g.inTrigger(CGPoint(x: 3200, y: 1640)))
        #expect(!g.inTrigger(CGPoint(x: 960, y: 1080))) // the top-centre of the other display
    }

    @Test func aNotchMakesThePanelTallerSoContentClearsIt() {
        let g = IslandGeometry(screen: CGRect(x: 0, y: 0, width: 1512, height: 982), topInset: 32)
        let frame = g.frame(.compact, visible: true)
        #expect(frame.height == 68)
        #expect(frame.maxY == 982)
    }

    @Test func neverWiderThanANarrowDisplay() {
        let g = IslandGeometry(screen: CGRect(x: 0, y: 0, width: 300, height: 600))
        #expect(g.frame(.expanded, visible: true).width == 284)
        #expect(g.frame(.expanded, visible: true).minX == 8)
    }

    @Test func triggerIsTheTopEdgeNearTheCentre() {
        #expect(geometry.inTrigger(CGPoint(x: 960, y: 1080)))
        #expect(geometry.inTrigger(CGPoint(x: 800, y: 1079))) // 160 from the centre: the edge of the strip
        #expect(!geometry.inTrigger(CGPoint(x: 799, y: 1080)))
        #expect(!geometry.inTrigger(CGPoint(x: 960, y: 1077))) // in the menu bar, not at the edge
        #expect(!geometry.inTrigger(CGPoint(x: 100, y: 1080))) // top edge, but far from the centre
    }

    @Test func keepZoneCoversThePanelAndAMargin() {
        #expect(geometry.inKeepZone(CGPoint(x: 960, y: 1060), .compact)) // over the pill
        #expect(geometry.inKeepZone(CGPoint(x: 840, y: 1030), .compact)) // within the margin
        #expect(!geometry.inKeepZone(CGPoint(x: 960, y: 900), .compact)) // well below it
        #expect(!geometry.inKeepZone(CGPoint(x: 600, y: 1075), .compact)) // menu bar, to the side
        #expect(geometry.inKeepZone(CGPoint(x: 960, y: 800), .expanded)) // the expanded view is taller
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
}

@Suite("IslandStatus")
struct IslandStatusTests {
    @Test func followsTheRuntime() {
        var status = IslandStatus()
        #expect(status.label == "Starting…" && status.tone == .waiting)
        status.apply(.ready(ReadyInfo(protocolVersion: 1, provider: "gemini", model: "m", microphone: ":default", voice: true)))
        #expect(status.label == "Ready" && status.tone == .ready)
        status.apply(.state(.thinking))
        #expect(status.label == "Thinking" && status.tone == .busy)
        status.apply(.micLevel(0.4)) // does not change the line
        #expect(status.label == "Thinking")
        status.apply(.error(RuntimeError(stage: "model", message: "quota")))
        #expect(status.tone == .problem)
        status.apply(.state(.idle))
        #expect(status.label == "Ready")
        status.apply(RuntimeSupervisor.Status.restarting(after: 1))
        #expect(status.label == "Restarting…" && status.tone == .waiting)
        status.apply(RuntimeSupervisor.Status.configError("missing key"))
        #expect(status.label == "Check settings" && status.tone == .problem)
    }
}
