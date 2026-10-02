import Testing
@testable import ZenoIslandCore

/// Key codes used below.
private enum K {
    static let leftControl: UInt16 = 59, leftOption: UInt16 = 58, rightOption: UInt16 = 61, leftShift: UInt16 = 56
    static let leftCommand: UInt16 = 55, fn: UInt16 = 63
    static let z: UInt16 = 6, a: UInt16 = 0, leftArrow: UInt16 = 123, space: UInt16 = 49
}

private func defaults() -> [ShortcutAction: KeyCombo] {
    var all: [ShortcutAction: KeyCombo] = [:]
    for action in ShortcutAction.allCases { all[action] = action.defaultCombo }
    return all
}

/// Drives a matcher with a fake clock.
private struct Keyboard {
    var matcher = ShortcutMatcher(armDelay: 0.2)
    var now = 0.0
    var fired: [ShortcutTrigger] = []

    init(_ shortcuts: [ShortcutAction: KeyCombo] = defaults()) {
        _ = matcher.setShortcuts(shortcuts)
    }

    mutating func flags(_ key: UInt16, _ modifiers: Modifiers) { fired += matcher.handle(.flagsChanged(keyCode: key, modifiers: modifiers), at: now) }
    mutating func down(_ key: UInt16, _ modifiers: Modifiers = [], isRepeat: Bool = false) {
        fired += matcher.handle(.keyDown(keyCode: key, modifiers: modifiers, isRepeat: isRepeat), at: now)
    }
    mutating func up(_ key: UInt16) { fired += matcher.handle(.keyUp(keyCode: key), at: now) }
    /// Lets time pass, ticking like the app's timer does.
    mutating func wait(_ seconds: Double) {
        let end = now + seconds
        while let deadline = matcher.nextDeadline, deadline <= end {
            now = deadline
            fired += matcher.tick(at: now)
        }
        now = end
    }

    /// Press ⌃ then ⌥.
    mutating func holdControlOption() {
        flags(K.leftControl, [.control])
        flags(K.leftOption, [.control, .option])
    }

    mutating func releaseAll() {
        flags(K.leftOption, [.control])
        flags(K.leftControl, [])
    }
}

@Suite("Shortcut matcher: hold to talk")
struct HoldToTalkTests {
    @Test func holdStartsAfterTheDelayAndReleaseSends() {
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.1)
        #expect(kb.fired.isEmpty, "not before the delay")
        kb.wait(0.2)
        #expect(kb.fired == [.holdBegan(.talk)])
        kb.wait(3) // talking
        kb.releaseAll()
        #expect(kb.fired == [.holdBegan(.talk), .holdEnded(.talk)])
    }

    @Test func releasingOneModifierSends() {
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.5)
        kb.flags(K.leftOption, [.control]) // ⌥ up, ⌃ still down
        #expect(kb.fired == [.holdBegan(.talk), .holdEnded(.talk)])
        kb.flags(K.leftControl, [])
        #expect(kb.fired.count == 2, "nothing more when the last modifier goes up")
    }

    @Test func quickTapDoesNothing() {
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.05)
        kb.releaseAll()
        kb.wait(1)
        #expect(kb.fired.isEmpty)
    }

    @Test func chordOnTheWayToAKeyNeverStarts() {
        // ⌃⌥← (e.g. switching Spaces) must not talk.
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.08)
        kb.down(K.leftArrow, [.control, .option, .function])
        kb.up(K.leftArrow)
        kb.wait(1)
        kb.releaseAll()
        #expect(kb.fired.isEmpty)
    }

    @Test func keyWhileHoldingCancels() {
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.5)
        kb.down(K.leftArrow, [.control, .option, .function])
        #expect(kb.fired == [.holdBegan(.talk), .holdCancelled(.talk)])
        // Still held after the cancel: nothing restarts until every modifier is up.
        kb.up(K.leftArrow)
        kb.wait(1)
        kb.releaseAll()
        #expect(kb.fired == [.holdBegan(.talk), .holdCancelled(.talk)])
    }

    @Test func addingAModifierCancels() {
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.5)
        kb.flags(K.leftShift, [.control, .option, .shift])
        #expect(kb.fired == [.holdBegan(.talk), .holdCancelled(.talk)])
    }

    @Test func extraModifierBeforeTheDelayNeverStarts() {
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.05)
        kb.flags(K.leftCommand, [.control, .option, .command])
        kb.wait(1)
        kb.flags(K.leftCommand, [.control, .option]) // back to exactly ⌃⌥, but not a clean press
        kb.wait(1)
        #expect(kb.fired.isEmpty)
    }

    @Test func worksAgainAfterEverythingIsReleased() {
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.5)
        kb.down(K.a, [.control, .option])
        kb.releaseAll()
        kb.holdControlOption()
        kb.wait(0.5)
        kb.releaseAll()
        #expect(kb.fired == [.holdBegan(.talk), .holdCancelled(.talk), .holdBegan(.talk), .holdEnded(.talk)])
    }

    @Test func keyRepeatIsIgnored() {
        var kb = Keyboard([.toggleIsland: KeyCombo(modifiers: [.function], keyCode: K.z)])
        kb.flags(K.fn, [.function])
        kb.down(K.z, [.function])
        kb.down(K.z, [.function], isRepeat: true)
        kb.down(K.z, [.function], isRepeat: true)
        #expect(kb.fired == [.pressed(.toggleIsland)])
    }

    @Test func chordFiredElsewhereSpoilsTheHold() {
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.5)
        kb.fired += kb.matcher.handle(.otherKey, at: kb.now)
        #expect(kb.fired == [.holdBegan(.talk), .holdCancelled(.talk)])
    }

    @Test func resetCancelsAndForgetsHeldKeys() {
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.5)
        kb.fired += kb.matcher.handle(.reset, at: kb.now)
        #expect(kb.fired == [.holdBegan(.talk), .holdCancelled(.talk)])
        #expect(!kb.matcher.isHolding)
        kb.holdControlOption()
        kb.wait(0.5)
        #expect(kb.fired.last == .holdBegan(.talk))
    }
}

@Suite("Shortcut matcher: sides, fn and changes")
struct MatcherSideTests {
    @Test func rightOptionDictates() {
        var kb = Keyboard()
        kb.flags(K.rightOption, [.option])
        kb.wait(0.5)
        kb.flags(K.rightOption, [])
        #expect(kb.fired == [.holdBegan(.dictate), .holdEnded(.dictate)])
    }

    @Test func leftOptionDoesNotDictate() {
        var kb = Keyboard()
        kb.flags(K.leftOption, [.option])
        kb.wait(0.5)
        kb.flags(K.leftOption, [])
        #expect(kb.fired.isEmpty)
    }

    @Test func bothOptionsDoNotDictate() {
        var kb = Keyboard()
        kb.flags(K.rightOption, [.option])
        kb.flags(K.leftOption, [.option]) // flags unchanged, another ⌥ key down
        kb.wait(0.5)
        #expect(kb.fired.isEmpty)
    }

    @Test func rightOptionThenControlIsTalkNotDictate() {
        var kb = Keyboard()
        kb.flags(K.rightOption, [.option])
        kb.wait(0.05)
        kb.flags(K.leftControl, [.control, .option])
        kb.wait(0.5)
        // The ⌥ was the start of ⌃⌥, which is a clean press of Talk.
        #expect(kb.fired == [.holdBegan(.talk)])
    }

    @Test func rightOptionTypingASpecialCharacterCancels() {
        // Right ⌥ + E types an accent: dictation must not run.
        var kb = Keyboard()
        kb.flags(K.rightOption, [.option])
        kb.wait(0.05)
        kb.down(14, [.option])
        kb.up(14)
        kb.wait(1)
        kb.flags(K.rightOption, [])
        #expect(kb.fired.isEmpty)
    }

    @Test func fnHoldOnItsOwn() {
        var kb = Keyboard([.talk: KeyCombo(modifiers: .function)])
        kb.flags(K.fn, [.function])
        kb.wait(0.5)
        kb.flags(K.fn, [])
        #expect(kb.fired == [.holdBegan(.talk), .holdEnded(.talk)])
    }

    @Test func keyedHoldEndsOnKeyUp() {
        var kb = Keyboard([.talk: KeyCombo(modifiers: .function, keyCode: K.space)])
        kb.flags(K.fn, [.function])
        kb.down(K.space, [.function])
        kb.wait(2)
        kb.up(K.space)
        #expect(kb.fired == [.holdBegan(.talk), .holdEnded(.talk)])
    }

    @Test func chordsWithoutFnAreLeftToSystemHotKeys() {
        var kb = Keyboard()
        kb.flags(K.leftControl, [.control])
        kb.flags(K.leftOption, [.control, .option])
        kb.down(K.z, [.control, .option]) // the default ⌃⌥Z
        #expect(kb.fired.isEmpty)
        #expect(ShortcutMatcher.needsKeyTracking(ShortcutAction.talk.defaultCombo))
        #expect(ShortcutMatcher.needsKeyTracking(ShortcutAction.dictate.defaultCombo))
        #expect(!ShortcutMatcher.needsKeyTracking(ShortcutAction.toggleIsland.defaultCombo))
        #expect(!ShortcutMatcher.needsKeyTracking(ShortcutAction.cancel.defaultCombo))
    }

    @Test func clearedShortcutNeverFires() {
        var shortcuts = defaults()
        shortcuts[.talk] = nil
        var kb = Keyboard(shortcuts)
        kb.holdControlOption()
        kb.wait(1)
        kb.releaseAll()
        #expect(kb.fired.isEmpty)
    }

    @Test func changingAHeldShortcutCancelsIt() {
        var kb = Keyboard()
        kb.holdControlOption()
        kb.wait(0.5)
        var changed = defaults()
        changed[.talk] = KeyCombo(modifiers: [.control, .command])
        kb.fired += kb.matcher.setShortcuts(changed)
        #expect(kb.fired == [.holdBegan(.talk), .holdCancelled(.talk)])
        kb.releaseAll()
        #expect(kb.fired.count == 2)
    }

    @Test func newShortcutWorksAtOnce() {
        var changed = defaults()
        changed[.talk] = KeyCombo(modifiers: [.control, .command])
        var kb = Keyboard(changed)
        kb.flags(K.leftControl, [.control])
        kb.flags(K.leftCommand, [.control, .command])
        kb.wait(0.5)
        #expect(kb.fired == [.holdBegan(.talk)])
    }

    @Test func noDeadlineWhenNothingIsWaiting() {
        var kb = Keyboard()
        #expect(kb.matcher.nextDeadline == nil)
        kb.holdControlOption()
        #expect(kb.matcher.nextDeadline == 0.2)
        kb.wait(0.3)
        #expect(kb.matcher.nextDeadline == nil)
    }
}
