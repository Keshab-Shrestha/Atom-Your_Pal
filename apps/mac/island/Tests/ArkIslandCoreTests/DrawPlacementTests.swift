import CoreGraphics
import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Draw on screen (2026-11-05)") struct DrawPlacementTests {
    private let main = ScreenArea(frame: CGRect(x: 0, y: 0, width: 1000, height: 800), visible: CGRect(x: 0, y: 0, width: 1000, height: 770))

    @Test func theDriversTopLeftBecomesTheDisplaysTopLeftWithPadding() throws {
        // A 100 x 40 element 50 across and 60 down from the top of the main display.
        let layout = try #require(DrawPlacement.layout(for: PointTarget(x: 50, y: 60, w: 100, h: 40, label: "", shape: .box), screens: [main]))
        #expect(layout.screenFrame == main.frame)
        #expect(layout.local == CGRect(x: 42, y: 52, width: 116, height: 56))
    }

    @Test func aSecondDisplayUsesItsOwnOrigin() throws {
        let right = ScreenArea(frame: CGRect(x: 1000, y: 0, width: 800, height: 600), visible: CGRect(x: 1000, y: 0, width: 800, height: 600))
        let layout = try #require(DrawPlacement.layout(for: PointTarget(x: 1100, y: 300, w: 50, h: 50, label: ""), screens: [main, right]))
        #expect(layout.screenFrame == right.frame)
        #expect(layout.local == CGRect(x: 92, y: 92, width: 66, height: 66))
    }

    @Test func nonsenseAndOffScreenPlacesDrawNothing() {
        #expect(DrawPlacement.layout(for: PointTarget(x: .nan, y: 0, w: 10, h: 10, label: ""), screens: [main]) == nil)
        #expect(DrawPlacement.layout(for: PointTarget(x: 0, y: 0, w: 0, h: 10, label: ""), screens: [main]) == nil)
        #expect(DrawPlacement.layout(for: PointTarget(x: 5000, y: 5000, w: 10, h: 10, label: ""), screens: [main]) == nil)
        #expect(DrawPlacement.layout(for: PointTarget(x: 0, y: 0, w: 10, h: 10, label: ""), screens: []) == nil)
    }

    @Test func theEventCarriesAKnownShapeOnly() throws {
        guard case .computerPoint(let drawn) = try decodeEvent(#"{"type":"computer.point","x":1,"y":2,"w":3,"h":4,"label":"here","shape":"arrow"}"#) else { Issue.record("not a point"); return }
        #expect(drawn.shape == .arrow)
        guard case .computerPoint(let odd) = try decodeEvent(#"{"type":"computer.point","x":1,"y":2,"w":3,"h":4,"label":"here","shape":"star"}"#) else { Issue.record("not a point"); return }
        #expect(odd.shape == nil, "an unknown shape draws nothing; the pointing still happens")
    }
}
