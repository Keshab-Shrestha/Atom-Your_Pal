import CoreGraphics
import Foundation
import Testing
@testable import AtomIslandCore

/// Two 1920×1080 displays side by side, as on Keshab's Mac. AppKit coordinates: origin at the primary display's
/// bottom-left, y up. The primary has a 30 pt menu bar and a 60 pt Dock; the second has neither.
private let primary = ScreenArea(frame: CGRect(x: 0, y: 0, width: 1920, height: 1080), visible: CGRect(x: 0, y: 60, width: 1920, height: 990))
private let second = ScreenArea(frame: CGRect(x: 1920, y: 0, width: 1920, height: 1080), visible: CGRect(x: 1920, y: 0, width: 1920, height: 1080))
private let screens = [primary, second]
private let palHeight: CGFloat = 54
private let half: CGFloat = 22

private func flight(_ x: Double, _ y: Double, _ w: Double, _ h: Double, on displays: [ScreenArea] = screens) -> PointFlight? {
    PointPlacement.flight(to: PointTarget(x: x, y: y, w: w, h: h, label: "here"), screens: displays, palHeight: palHeight, palHalfWidth: half)
}

@Suite("Pointing: where Pal stands")
struct PointPlacementTests {
    @Test func convertsFromTheDriversTopLeftOriginAndStandsOnTheElement() throws {
        // Cua: 90×24 at (100, 500), y measured down from the top. AppKit: its top edge is at 1080 − 500 = 580.
        let f = try #require(flight(100, 500, 90, 24))
        #expect(f.feet.x == 145)
        #expect(f.feet.y == 582) // just above the top edge: Pal stands on it
        #expect(f.bubbleSide == .above)
    }

    @Test func worksOnTheSecondDisplay() throws {
        let f = try #require(flight(2133, 85, 90, 24)) // TextEdit's button, measured live
        #expect(f.feet.x >= 1920 && f.feet.x <= 3840)
        #expect(f.feet.x == 2178)
        // 85 pt from the top of the display: no room above for Pal (54) and its bubble (60), so Pal hangs
        // under the element's bottom edge (1080 − 85 − 24 = 971), 6 pt clear of it.
        #expect(f.bubbleSide == .below)
        #expect(abs(f.feet.y - 911) < 0.001) // 971 − 6 − 54
    }

    @Test func standsOnTheElementWhenThereIsRoomAboveOnTheSecondDisplay() throws {
        let f = try #require(flight(2133, 400, 90, 24))
        #expect(f.bubbleSide == .above)
        #expect(abs(f.feet.y - 682) < 0.001) // the element's top edge, 680, plus 2
    }

    @Test func nearTheTopPalStandsBelowSoTheBubbleHasRoom() throws {
        let f = try #require(flight(900, 60, 80, 20)) // just under the menu bar
        #expect(f.bubbleSide == .below)
        let element = CGRect(x: 900, y: 1080 - 60 - 20, width: 80, height: 20)
        #expect(f.feet.y + palHeight <= element.minY) // Pal hangs under it
    }

    @Test func anItemInTheMenuBarIsPointedAtFromBelow() throws {
        let f = try #require(flight(1700, 4, 40, 22))
        #expect(f.bubbleSide == .below)
        #expect(f.feet.y + palHeight < 1080 - 4 - 22 + 1)
    }

    @Test func anItemInTheDockIsPointedAtFromAbove() throws {
        let f = try #require(flight(900, 1040, 60, 30)) // below the visible area
        #expect(f.bubbleSide == .above)
        #expect(f.feet.y >= 1080 - 1040 - 30)
    }

    @Test func keepsPalOffTheEdgeOfTheDisplay() throws {
        let left = try #require(flight(0, 500, 20, 20))
        #expect(left.feet.x >= half + 8)
        let right = try #require(flight(3830, 500, 10, 20))
        #expect(right.feet.x <= 3840 - half - 8)
    }

    @Test func aPlaceOffEveryDisplayIsNotFlownTo() {
        #expect(flight(5000, 100, 40, 40) == nil)
        #expect(flight(-900, 100, 40, 40) == nil)
        #expect(flight(100, 4000, 40, 40) == nil)
    }

    @Test func nonsenseNumbersAreNotFlownTo() {
        #expect(flight(.nan, 10, 10, 10) == nil)
        #expect(flight(10, .infinity, 10, 10) == nil)
        #expect(flight(10, 10, 0, 10) == nil)
        #expect(flight(10, 10, 10, -3) == nil)
        #expect(flight(100, 100, 10, 10, on: []) == nil)
    }

    @Test func aHugeElementStillGetsAPlaceOnScreen() throws {
        let f = try #require(flight(0, 30, 1920, 990)) // a whole window
        #expect(primary.visible.contains(f.feet))
        #expect(f.feet.y + palHeight <= primary.visible.maxY)
    }

    @Test func neverCoversTheElementWithPalOrItsBubble() throws {
        // Every small element on a grid over both displays, including corners, the menu bar and the Dock.
        for x in stride(from: 0.0, through: 3800.0, by: 97) {
            for y in stride(from: 0.0, through: 1060.0, by: 53) {
                for (w, h) in [(20.0, 20.0), (90.0, 24.0), (120.0, 60.0)] {
                    guard let f = flight(x, y, w, h) else { continue }
                    let element = CGRect(x: x, y: 1080 - y - h, width: w, height: h)
                    let body = CGRect(x: f.feet.x - half, y: f.feet.y, width: 2 * half, height: palHeight)
                    #expect(!body.intersects(element), "Pal covers the element at \(x),\(y) \(w)×\(h)")
                    let bubble = BubbleLayout.place(feet: f.feet, bodyHeight: palHeight, in: (screens.first { $0.frame.contains(CGPoint(x: element.midX, y: element.midY)) } ?? primary).visible, prefer: f.bubbleSide)
                    #expect(bubble.side == f.bubbleSide, "bubble ignored the side at \(x),\(y)")
                    #expect(!bubble.frame.intersects(element), "bubble covers the element at \(x),\(y) \(w)×\(h)")
                }
            }
        }
    }
}

@Suite("Bubble side preference")
struct BubbleSideTests {
    let bounds = CGRect(x: 0, y: 0, width: 1920, height: 1080)
    let feet = CGPoint(x: 900, y: 500)

    @Test func noPreferenceKeepsTheOldBehaviour() {
        #expect(BubbleLayout.place(feet: feet, in: bounds).side == .above)
        #expect(BubbleLayout.place(feet: CGPoint(x: 900, y: 1040), in: bounds).side == .below)
    }

    @Test func aPreferredSideIsUsedWhenItFits() {
        #expect(BubbleLayout.place(feet: feet, in: bounds, prefer: .below).side == .below)
        #expect(BubbleLayout.place(feet: feet, in: bounds, prefer: .above).side == .above)
    }

    @Test func aPreferredSideThatDoesNotFitIsIgnored() {
        #expect(BubbleLayout.place(feet: CGPoint(x: 900, y: 1040), in: bounds, prefer: .above).side == .below)
        #expect(BubbleLayout.place(feet: CGPoint(x: 900, y: 20), in: bounds, prefer: .below).side == .above)
    }
}

@Suite("Pointing: the event")
struct PointEventTests {
    @Test func decodesAPoint() throws {
        let event = try decodeEvent(#"{"type":"computer.point","x":2133,"y":85,"w":90,"h":24,"label":"the settings button"}"#)
        #expect(event == .computerPoint(PointTarget(x: 2133, y: 85, w: 90, h: 24, label: "the settings button")))
        #expect(event.name == "computer.point")
    }

    @Test func aLabelIsRequiredButMayBeEmpty() throws {
        #expect(try decodeEvent(#"{"type":"computer.point","x":1,"y":2,"w":3,"h":4,"label":""}"#) == .computerPoint(PointTarget(x: 1, y: 2, w: 3, h: 4, label: "")))
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"computer.point","x":1,"y":2,"w":3,"h":4}"#) }
    }

    @Test func badNumbersAreErrorsNotCrashes() {
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"computer.point","x":"1","y":2,"w":3,"h":4,"label":"a"}"#) }
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"computer.point","x":true,"y":2,"w":3,"h":4,"label":"a"}"#) }
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"computer.point","x":1,"y":2,"w":0,"h":4,"label":"a"}"#) }
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"computer.point","x":1,"y":2,"w":3,"h":-4,"label":"a"}"#) }
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"computer.point","y":2,"w":3,"h":4,"label":"a"}"#) }
    }

    @Test func aPointShowsAsUsingTheMacWhileATurnRuns() {
        var status = IslandStatus()
        status.apply(.state(.thinking))
        status.apply(.computerPoint(PointTarget(x: 1, y: 2, w: 3, h: 4, label: "x")))
        #expect(status.kind == .acting)
        #expect(status.detail == "Pointing")
        var idle = IslandStatus()
        idle.apply(.computerPoint(PointTarget(x: 1, y: 2, w: 3, h: 4, label: "x")))
        #expect(idle.kind != .acting) // a late point after the turn ended does not light the island
    }

    @Test func aPointDoesNotTouchAPendingApproval() {
        var state = ApprovalState()
        state.apply(.approvalRequest(ApprovalRequest(id: "a", summary: "s", reason: "r")))
        state.apply(.computerPoint(PointTarget(x: 1, y: 2, w: 3, h: 4, label: "x")))
        #expect(state.pending?.id == "a")
    }
}

@Suite("Pointing: what is being pointed at")
struct PointingStateTests {
    let a = PointTarget(x: 1, y: 2, w: 30, h: 40, label: "the settings button")
    let b = PointTarget(x: 9, y: 8, w: 30, h: 40, label: "the search box")

    @Test func startsEmptyAndHoldsTheLatestPoint() {
        var state = PointingState()
        #expect(state.target == nil)
        state.apply(.computerPoint(a))
        #expect(state.target == a)
        state.apply(.computerPoint(b))
        #expect(state.target == b)
    }

    @Test func aNewTurnTheResetAnErrorAndARestartClearIt() {
        for event in [IslandEvent.state(.listening), .conversationReset, .error(RuntimeError(stage: "model", message: "x"))] {
            var state = PointingState()
            state.apply(.computerPoint(a))
            state.apply(event)
            #expect(state.target == nil, "\(event.name)")
        }
        var state = PointingState()
        state.apply(.computerPoint(a))
        state.runtimeStopped()
        #expect(state.target == nil)
    }

    @Test func otherEventsLeaveItAlone() {
        var state = PointingState()
        state.apply(.computerPoint(a))
        for event in [IslandEvent.state(.thinking), .state(.speaking), .state(.idle), .computerStep("Looking at Mail"), .reply("here"), .micLevel(0.4)] {
            state.apply(event)
        }
        #expect(state.target == a) // the turn ending does not end the point: Pal stays a moment so it is seen
    }

    @Test func clearEndsIt() {
        var state = PointingState()
        state.apply(.computerPoint(a))
        state.clear()
        #expect(state.target == nil)
    }

    @Test func theBubbleLineUsesTheLabelOrAFallback() {
        #expect(PointingState.line(for: a) == "the settings button")
        #expect(PointingState.line(for: PointTarget(x: 1, y: 2, w: 3, h: 4, label: "")) == "Here")
        #expect(PointingState.line(for: PointTarget(x: 1, y: 2, w: 3, h: 4, label: "   ")) == "Here")
    }
}
