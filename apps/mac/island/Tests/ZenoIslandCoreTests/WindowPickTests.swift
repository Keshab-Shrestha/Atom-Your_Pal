import CoreGraphics
import Testing
@testable import ZenoIslandCore

@Suite("Drop Wisp on a window (ADR-074)")
struct WindowPickTests {
    let me: Int32 = 100
    func window(_ pid: Int32, _ rect: CGRect, layer: Int = 0, onScreen: Bool = true) -> WindowInfo {
        WindowInfo(pid: pid, layer: layer, bounds: rect, isOnScreen: onScreen)
    }

    @Test func picksTheFrontWindowUnderThePoint() {
        let front = window(1, CGRect(x: 0, y: 0, width: 400, height: 300))
        let back = window(2, CGRect(x: 0, y: 0, width: 800, height: 600))
        #expect(WindowPick.window(at: CGPoint(x: 100, y: 100), in: [front, back], ownPID: me) == front)
        #expect(WindowPick.window(at: CGPoint(x: 600, y: 500), in: [front, back], ownPID: me) == back)
    }

    @Test func skipsOwnWindowsOtherLayersAndOffScreen() {
        let rect = CGRect(x: 0, y: 0, width: 400, height: 300)
        let target = window(5, rect)
        let list = [window(me, rect), window(3, rect, layer: 25), window(4, rect, onScreen: false), target]
        #expect(WindowPick.window(at: CGPoint(x: 10, y: 10), in: list, ownPID: me) == target)
    }

    @Test func nilWhenNoWindowIsUnderThePoint() {
        let list = [window(1, CGRect(x: 0, y: 0, width: 100, height: 100)), window(me, CGRect(x: 500, y: 500, width: 100, height: 100))]
        #expect(WindowPick.window(at: CGPoint(x: 550, y: 550), in: list, ownPID: me) == nil)
        #expect(WindowPick.window(at: .zero, in: [], ownPID: me) == nil)
    }

    @Test func optionDropOnAWindowAsks() {
        let w = window(1, CGRect(x: 0, y: 0, width: 10, height: 10))
        #expect(PetDrop.decide(optionHeld: true, window: w) == .ask(w))
    }

    @Test func otherDropsPark() {
        let w = window(1, CGRect(x: 0, y: 0, width: 10, height: 10))
        #expect(PetDrop.decide(optionHeld: false, window: w) == .park)
        #expect(PetDrop.decide(optionHeld: true, window: nil) == .park)
    }

    @Test func convertsWindowListBoundsToAppKit() {
        // A 1440×900 primary display: a window 100 pt from the top, 200 tall, has its bottom 600 pt up.
        let appKit = WindowPick.appKitRect(CGRect(x: 50, y: 100, width: 300, height: 200), primaryHeight: 900)
        #expect(appKit == CGRect(x: 50, y: 600, width: 300, height: 200))
        // A display above the primary one has negative window-list y.
        #expect(WindowPick.appKitRect(CGRect(x: 0, y: -500, width: 100, height: 100), primaryHeight: 900).minY == 1300)
    }

    @Test func puttingWispBackLeavesItsSpotAlone() {
        var walking = PetBrain(width: 1000, now: 0)
        let x = walking.x
        walking.grab(at: 1)
        walking.putBack(at: 2)
        #expect(!walking.pinned && walking.x == x && walking.mood != .carried)

        var parked = PetBrain(width: 1000, now: 0)
        parked.grab(at: 1)
        parked.drop(homeX: nil, at: 2) // parked somewhere
        parked.grab(at: 3)
        parked.putBack(at: 4)
        #expect(parked.pinned && parked.mood != .carried)
    }
}
