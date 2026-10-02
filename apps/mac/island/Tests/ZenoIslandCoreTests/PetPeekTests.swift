import Foundation
import Testing
@testable import ZenoIslandCore

@Suite("Wisp tucks away")
struct PetPeekTests {
    private let main = CGRect(x: 0, y: 0, width: 1440, height: 900)

    @Test func hidesAtTheNearerEdge() {
        #expect(PeekLayout.choose(feet: CGPoint(x: 200, y: 50), displays: [main])?.edge == .left)
        #expect(PeekLayout.choose(feet: CGPoint(x: 1300, y: 50), displays: [main])?.edge == .right)
    }

    @Test func skipsAnEdgeThatTouchesAnotherDisplay() {
        let right = CGRect(x: 1440, y: 0, width: 1920, height: 1080)
        // On the left display the right edge is shared: only the left edge is free, even though Wisp is nearer the right.
        #expect(PeekLayout.choose(feet: CGPoint(x: 1400, y: 50), displays: [main, right])?.edge == .left)
        // On the right display it is the other way round.
        #expect(PeekLayout.choose(feet: CGPoint(x: 1500, y: 50), displays: [main, right])?.edge == .right)
    }

    @Test func staysPutWhenBothEdgesTouchOtherDisplays() {
        let left = CGRect(x: -1440, y: 0, width: 1440, height: 900)
        let right = CGRect(x: 1440, y: 0, width: 1440, height: 900)
        #expect(PeekLayout.choose(feet: CGPoint(x: 700, y: 50), displays: [left, main, right]) == nil)
    }

    @Test func aNeighbourAboveOrBelowDoesNotBlockAnEdge() {
        let above = CGRect(x: 0, y: 900, width: 1440, height: 900)
        #expect(PeekLayout.choose(feet: CGPoint(x: 700, y: 50), displays: [main, above]) != nil)
    }

    @Test func aNeighbourOnlyBlocksAtTheHeightWhereItIs() {
        // A small display beside the top half only: Wisp low down can still hide at that edge.
        let beside = CGRect(x: 1440, y: 600, width: 800, height: 600)
        #expect(PeekLayout.choose(feet: CGPoint(x: 1400, y: 50), displays: [main, beside])?.edge == .right)
        #expect(PeekLayout.choose(feet: CGPoint(x: 1400, y: 700), displays: [main, beside])?.edge == .left)
    }

    @Test func noDisplayUnderWispMeansNoPeek() {
        #expect(PeekLayout.choose(feet: CGPoint(x: -500, y: 50), displays: [main]) == nil)
    }

    @Test func feetAndTurnFollowTheEdge() {
        let left = Peek(edge: .left, display: main)
        let right = Peek(edge: .right, display: main)
        #expect(PeekLayout.feet(for: left, y: 120) == CGPoint(x: PeekLayout.inset, y: 120))
        #expect(PeekLayout.feet(for: right, y: 120) == CGPoint(x: 1440 - PeekLayout.inset, y: 120))
        // Pointing at the head slides it out further, at the same edge and height.
        #expect(PeekLayout.feet(for: left, y: 120, revealed: true) == CGPoint(x: PeekLayout.inset + PeekLayout.revealExtra, y: 120))
        #expect(PeekLayout.feet(for: right, y: 120, revealed: true) == CGPoint(x: 1440 - PeekLayout.inset - PeekLayout.revealExtra, y: 120))
        #expect(PeekLayout.rotation(for: left) == 42)   // the head tips right, into the display
        #expect(PeekLayout.rotation(for: right) == -42) // the head tips left
    }

    @Test func retreatsAfterTheTimeout() {
        var retreat = PetRetreat(timeout: 30, now: 100)
        #expect(!retreat.isDue(at: 129, blocked: false))
        #expect(retreat.isDue(at: 130, blocked: false))
        retreat.wake(at: 130)
        #expect(!retreat.isDue(at: 159, blocked: false))
        #expect(retreat.isDue(at: 160, blocked: false))
    }

    @Test func neverMeansNever() {
        let retreat = PetRetreat(timeout: 0, now: 0)
        #expect(!retreat.isDue(at: 1_000_000, blocked: false))
    }

    @Test func aBusyWispDoesNotRetreat() {
        let retreat = PetRetreat(timeout: 15, now: 0)
        #expect(!retreat.isDue(at: 500, blocked: true))
        #expect(retreat.isDue(at: 500, blocked: false))
    }

    @Test func aPressOpensThePanelAndAnotherClosesIt() {
        #expect(PetClickAction.forPress(clickCount: 1, panelOpen: false) == .open)
        #expect(PetClickAction.forPress(clickCount: 1, panelOpen: true) == .close)
    }

    @Test func aDoubleClickLeavesThePanelOpen() {
        // First press opened it; the second (count 2) must not close it again.
        #expect(PetClickAction.forPress(clickCount: 2, panelOpen: true) == .none)
        #expect(PetClickAction.forPress(clickCount: 2, panelOpen: false) == .open)
    }

    @Test func timeoutChoicesAreOrdered() {
        let seconds = WispHideTimeout.allCases.map(\.seconds)
        #expect(seconds == seconds.sorted())
        #expect(WispHideTimeout.never.seconds == 0)
        #expect(WispHideTimeout.allCases.map(\.title) == ["Never", "15 s", "30 s", "1 min", "5 min"])
    }

    @Test func theFeaturesPanelStaysOnScreenBesideWisp() {
        let bounds = CGRect(x: 0, y: 0, width: 1440, height: 870) // below the menu bar
        let size = CGSize(width: 380, height: 460)
        // Standing on the Dock: the panel sits above Wisp.
        let low = BubbleLayout.place(feet: CGPoint(x: 700, y: 80), gap: 6, size: size, in: bounds)
        #expect(low.side == .above)
        #expect(low.frame.maxY <= bounds.maxY - 8)
        #expect(low.frame.minY >= 80)
        // Parked near the top: it drops below Wisp instead.
        let high = BubbleLayout.place(feet: CGPoint(x: 700, y: 700), gap: 6, size: size, in: bounds)
        #expect(high.side == .below)
        #expect(high.frame.maxY <= 700)
        // At the right edge it slides left and still sits on the display.
        let edge = BubbleLayout.place(feet: CGPoint(x: 1430, y: 80), gap: 6, size: size, in: bounds)
        #expect(edge.frame.maxX <= bounds.maxX - 8)
    }

    @Test func leanStaysInsideTheRequestedRange() {
        let left = Peek(edge: .left, display: main)
        for lean in WispLean.allCases {
            let degrees = abs(PeekLayout.rotation(for: left, lean: lean))
            #expect(degrees >= 35 && degrees <= 50)
        }
        #expect(PeekLayout.rotation(for: left, lean: .slight) < PeekLayout.rotation(for: left, lean: .deep))
    }

    @Test func theHidingPoseFollowsTheLean() {
        #expect(PeekLayout.amount(rotation: 0) == 0)
        #expect(PeekLayout.amount(rotation: 42) == 1)      // fully into the pose at the left edge
        #expect(PeekLayout.amount(rotation: -42) == -1)    // mirrored at the right edge
        #expect(PeekLayout.amount(rotation: 15) == 0.5)    // halfway while leaning in
        #expect(PeekLayout.amount(rotation: 90) == 1)      // never more than full
    }

    @Test func feetSitJustPastTheEdgeSoTheBodyIsCutOff() {
        let peek = Peek(edge: .left, display: main)
        #expect(PeekLayout.feet(for: peek, y: 50).x < 0)
        // Pointing at it slides the head further in, but never out of the hiding place.
        #expect(PeekLayout.feet(for: peek, y: 50, revealed: true).x > PeekLayout.feet(for: peek, y: 50).x)
        let right = Peek(edge: .right, display: main)
        #expect(PeekLayout.feet(for: right, y: 50).x > 1440)
    }
}
