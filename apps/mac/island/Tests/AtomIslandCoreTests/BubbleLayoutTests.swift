import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Pal's speech bubble")
struct BubbleLayoutTests {
    private let screen = CGRect(x: 0, y: 0, width: 1440, height: 860) // the area below the menu bar
    private func place(_ x: CGFloat, _ y: CGFloat) -> BubblePlacement {
        BubbleLayout.place(feet: CGPoint(x: x, y: y), in: screen)
    }

    @Test func sitsAbovePalCenteredOnIt() {
        let p = place(700, 100)
        #expect(p.side == .above)
        #expect(p.frame.midX == CGFloat(700))
        let expected: CGFloat = 100 + 54 + 4 // feet + Pal's height + gap
        #expect(p.frame.minY == expected, "clear of Pal's head")
        #expect(p.frame.size == BubbleLayout.size)
        #expect(p.tailX == BubbleLayout.size.width / 2)
    }

    @Test func slidesSidewaysAtTheEdgesButTheTailStillPointsAtPal() {
        let left = place(30, 100)
        #expect(left.frame.minX == 8)
        #expect(left.frame.minX + left.tailX == 30 || left.tailX == BubbleLayout.tailInset)
        let right = place(1430, 100)
        let edge: CGFloat = 1440 - 8
        #expect(right.frame.maxX == edge)
        #expect(right.tailX == BubbleLayout.size.width - BubbleLayout.tailInset, "clamped clear of the corner")
    }

    @Test func dropsBelowPalNearTheTopOfTheDisplay() {
        let p = place(700, 800)
        #expect(p.side == .below)
        let expected: CGFloat = 800 - 4
        #expect(p.frame.maxY == expected)
    }

    @Test func staysOnScreenWhenNeitherSideFits() {
        let tiny = CGRect(x: 0, y: 0, width: 1440, height: 120)
        let p = BubbleLayout.place(feet: CGPoint(x: 700, y: 60), in: tiny)
        #expect(p.frame.maxY <= tiny.maxY - 8)
    }

    @Test func followsPalOnASecondDisplay() {
        let second = CGRect(x: 1440, y: 0, width: 1920, height: 1080)
        let p = BubbleLayout.place(feet: CGPoint(x: 2200, y: 300), in: second)
        #expect(p.frame.midX == 2200 && p.side == .above)
        #expect(second.contains(p.frame))
    }

    @Test func aNarrowDisplayShrinksTheBubble() {
        let narrow = CGRect(x: 0, y: 0, width: 200, height: 600)
        let p = BubbleLayout.place(feet: CGPoint(x: 100, y: 50), in: narrow)
        #expect(p.frame.width == 184 && p.frame.minX == 8)
    }
}
