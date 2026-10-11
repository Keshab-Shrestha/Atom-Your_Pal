import CoreGraphics
import Testing
@testable import ZenoIslandCore

@Suite("Work strip: when it shows and what it says")
struct WorkStripStateTests {
    let step = IslandEvent.computerStep("Typing in TextEdit")

    @Test func ordinaryTalkNeverShowsIt() {
        var s = WorkStripState()
        s.apply(.state(.thinking), now: 0)
        s.apply(.state(.speaking), now: 1)
        s.apply(.state(.idle), now: 2)
        #expect(!s.isShown(at: 2))
    }

    @Test func theFirstStepShowsItWithThatStep() {
        var s = WorkStripState()
        s.apply(.state(.thinking), now: 0)
        s.apply(step, now: 1)
        #expect(s.isShown(at: 1))
        #expect(s.line == "Typing in TextEdit")
    }

    @Test func aPointOrAnApprovalAlsoShowsIt() {
        var a = WorkStripState()
        a.apply(.computerPoint(PointTarget(x: 1, y: 2, w: 3, h: 4, label: "the Send button")), now: 0)
        #expect(a.isShown(at: 0) && a.line == "Pointing at the Send button")
        var b = WorkStripState()
        b.apply(.approvalRequest(ApprovalRequest(id: "a", summary: "Press return in TextEdit", reason: "")), now: 0)
        #expect(b.isShown(at: 0) && b.line == "Press return in TextEdit")
    }

    @Test func itStaysAMomentAfterTheTurnThenGoes() {
        var s = WorkStripState(linger: 2.5)
        s.apply(step, now: 1)
        s.apply(.state(.idle), now: 10)
        #expect(s.line == "Done")
        #expect(s.isShown(at: 12.4))
        #expect(!s.isShown(at: 12.5))
    }

    @Test func itStaysUpForAsLongAsTheTurnRuns() {
        var s = WorkStripState()
        s.apply(step, now: 1)
        #expect(s.isShown(at: 500))
    }

    @Test func stopSaysStoppedAndGoes() {
        var s = WorkStripState(linger: 2)
        s.apply(step, now: 1)
        s.stopped(now: 3)
        #expect(s.line == "Stopped")
        #expect(!s.isShown(at: 5))
        s.apply(.state(.idle), now: 3.5) // the turn ending after Stop does not change what it says
        #expect(s.line == "Stopped")
    }

    @Test func anErrorSaysItCouldNotFinish() {
        var s = WorkStripState()
        s.apply(step, now: 1)
        s.apply(.error(RuntimeError(stage: "model", message: "boom")), now: 2)
        #expect(s.line == "Couldn't finish")
    }

    @Test func aNewRequestClearsItAtOnce() {
        var s = WorkStripState()
        s.apply(step, now: 1)
        s.apply(.state(.idle), now: 2)
        s.apply(.state(.listening), now: 2.2)
        #expect(!s.isShown(at: 2.2))
        #expect(s.line == "Working on your Mac")
    }

    @Test func aStepAfterTheTurnEndedStartsItAgain() {
        var s = WorkStripState()
        s.apply(step, now: 1)
        s.apply(.state(.idle), now: 2)
        s.apply(.computerStep("Clicking Save"), now: 3)
        #expect(s.isShown(at: 100) && s.line == "Clicking Save")
    }

    @Test func theRuntimeStoppingClearsIt() {
        var s = WorkStripState()
        s.apply(step, now: 1)
        s.runtimeStopped()
        #expect(!s.isShown(at: 1))
    }
}

@Suite("Work strip: where it goes")
struct WorkStripLayoutTests {
    // Keshab's main display: 1920 × 1080, menu bar 30, Dock 60.
    let visible = CGRect(x: 0, y: 60, width: 1920, height: 990)

    @Test func centredAboveTheDock() {
        let f = WorkStripLayout.frame(size: WorkStripLayout.size, visible: visible, clearance: 0)
        #expect(f.midX == 960)
        #expect(f.minY == 68) // 8 above the Dock
    }

    @Test func keepsPalsWalkwayClear() {
        let f = WorkStripLayout.frame(size: WorkStripLayout.size, visible: visible, clearance: 90)
        #expect(f.minY == 158)
    }

    @Test func neverOffATinyDisplay() {
        let tiny = CGRect(x: 0, y: 0, width: 300, height: 150)
        let f = WorkStripLayout.frame(size: WorkStripLayout.askingSize, visible: tiny, clearance: 90)
        #expect(f.width == 284 && f.minX == 8)
        #expect(f.minY >= 8)
    }
}

@Suite("Point label: where it goes")
struct PointLabelLayoutTests {
    let bounds = CGRect(x: 0, y: 0, width: 1920, height: 1050)

    @Test func besidePalOnTheRoomierSide() {
        let left = PointLabelLayout.frame(feet: CGPoint(x: 300, y: 500), palHeight: 54, palHalfWidth: 22, width: 120, in: bounds)
        #expect(left.minX == 328) // right of Pal: more room there
        let right = PointLabelLayout.frame(feet: CGPoint(x: 1800, y: 500), palHeight: 54, palHalfWidth: 22, width: 120, in: bounds)
        #expect(right.maxX == 1772) // left of Pal
    }

    @Test func inTheTopRightCornerItStaysOnTheDisplay() {
        // A target right under the menu bar at the far right: Pal hangs just under it.
        let f = PointLabelLayout.frame(feet: CGPoint(x: 1890, y: 990), palHeight: 54, palHalfWidth: 22, width: 200, in: bounds)
        #expect(f.maxX <= 1912 && f.minX >= 8)
        #expect(f.maxY <= 1042)
    }

    @Test func inTheTopLeftCornerItStaysOnTheDisplay() {
        let f = PointLabelLayout.frame(feet: CGPoint(x: 30, y: 990), palHeight: 54, palHalfWidth: 22, width: 200, in: bounds)
        #expect(f.minX >= 8 && f.maxY <= 1042)
        #expect(f.minX >= 30 + 22) // beside Pal, not over it
    }

    @Test func aLongLabelIsHeldToTheMaximumWidth() {
        let f = PointLabelLayout.frame(feet: CGPoint(x: 900, y: 500), palHeight: 54, palHalfWidth: 22, width: 900, in: bounds)
        #expect(f.width == PointLabelLayout.maxWidth)
    }
}
