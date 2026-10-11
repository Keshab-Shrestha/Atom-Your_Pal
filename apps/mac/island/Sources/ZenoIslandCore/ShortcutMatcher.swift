/// Turns raw key events into shortcut actions (ADR-040). Pure and clock-free: the caller passes the time,
/// so every rule is unit-tested without a keyboard.
///
/// It handles the shortcuts that need key-level tracking (`needsKeyTracking`): modifier-only holds (⌃⌥,
/// Right ⌥) and any shortcut that includes fn. Ordinary chords (⌃⌥Z, Esc) are registered as system hot keys
/// by the app instead, which need no permission and keep the key from reaching the app in front.
///
/// Rules for a modifier-only hold:
/// - It starts `armDelay` seconds after exactly its modifiers are down (the right-hand key, for a
///   right-side shortcut), so a chord on the way to another key (⌃⌥ → ⌃⌥Z) never starts it.
/// - It is a clean press: any other key, or another modifier, while held cancels it.
/// - Letting go of any of its modifiers ends it (send).
/// - After a cancel or end, nothing starts again until every modifier is up.

/// What the matcher reports.
public enum ShortcutTrigger: Equatable, Sendable {
    /// A press shortcut fired.
    case pressed(ShortcutAction)
    /// A hold shortcut started: start listening.
    case holdBegan(ShortcutAction)
    /// A hold shortcut was released cleanly: send.
    case holdEnded(ShortcutAction)
    /// A hold shortcut was spoiled by another key: abandon.
    case holdCancelled(ShortcutAction)
}

/// Key events, independent of AppKit and Core Graphics.
public enum KeyInput: Equatable, Sendable {
    /// A modifier key went down or up. `modifiers` is the full set held afterwards.
    case flagsChanged(keyCode: UInt16, modifiers: Modifiers)
    case keyDown(keyCode: UInt16, modifiers: Modifiers, isRepeat: Bool)
    case keyUp(keyCode: UInt16)
    /// A shortcut handled elsewhere (a system hot key) fired. Counts as another key.
    case otherKey
    /// Key tracking was interrupted (the event tap was disabled, the Mac slept). Forget held keys.
    case reset
}

public struct ShortcutMatcher: Sendable {
    /// Which hand a modifier key is on.
    enum Side: Sendable { case left, right }

    /// Virtual key codes of the modifier keys.
    static let modifierKeys: [UInt16: (Modifiers, Side)] = [
        55: (.command, .left), 54: (.command, .right),
        56: (.shift, .left), 60: (.shift, .right),
        58: (.option, .left), 61: (.option, .right),
        59: (.control, .left), 62: (.control, .right),
        63: (.function, .left), 179: (.function, .left),
    ]

    /// How long exactly a modifier-only hold's modifiers must be down before it starts.
    public var armDelay: Double
    /// Holds that start sooner or later than `armDelay`: dictation starts quickly so the first words are kept.
    public var armDelays: [ShortcutAction: Double]

    public private(set) var shortcuts: [ShortcutAction: KeyCombo] = [:]

    private var modifiers: Modifiers = []
    private var heldModifierKeys: Set<UInt16> = []
    /// Another key (or a chord) was pressed since the modifiers were last all up.
    private var dirty = false
    /// A modifier-only hold whose modifiers are down, waiting out `armDelay`.
    private var pending: (action: ShortcutAction, since: Double)?
    /// A modifier-only hold in progress.
    private var activeModifierHold: ShortcutAction?
    /// A keyed hold in progress (e.g. fn+Space held), ended by releasing its key.
    private var activeKeyHold: (action: ShortcutAction, keyCode: UInt16)?

    public init(armDelay: Double = 0.2, armDelays: [ShortcutAction: Double] = [:]) {
        self.armDelay = armDelay
        self.armDelays = armDelays
    }

    private func delay(for action: ShortcutAction) -> Double { armDelays[action] ?? armDelay }

    /// Whether a shortcut needs the key-level tracking done here, rather than a system hot key:
    /// modifier-only shortcuts, and fn, which system hot keys cannot include.
    public static func needsKeyTracking(_ combo: KeyCombo) -> Bool {
        combo.isModifierOnly || combo.modifiers.contains(.function)
    }

    /// When `tick` must be called next, if a hold is waiting to start.
    public var nextDeadline: Double? {
        pending.map { $0.since + delay(for: $0.action) }
    }

    /// Replaces the shortcuts. A hold in progress is cancelled if its shortcut changed.
    public mutating func setShortcuts(_ new: [ShortcutAction: KeyCombo]) -> [ShortcutTrigger] {
        var out: [ShortcutTrigger] = []
        if let action = activeModifierHold, new[action] != shortcuts[action] {
            activeModifierHold = nil
            dirty = !modifiers.isEmpty
            out.append(.holdCancelled(action))
        }
        if let hold = activeKeyHold, new[hold.action] != shortcuts[hold.action] {
            activeKeyHold = nil
            out.append(.holdCancelled(hold.action))
        }
        if let waiting = pending, new[waiting.action] != shortcuts[waiting.action] { pending = nil }
        shortcuts = new
        return out
    }

    public mutating func handle(_ input: KeyInput, at now: Double) -> [ShortcutTrigger] {
        switch input {
        case .flagsChanged(let keyCode, let newModifiers):
            return modifiersChanged(keyCode: keyCode, to: newModifiers, at: now)
        case .keyDown(let keyCode, let keyModifiers, let isRepeat):
            if isRepeat { return [] }
            var out = otherKeyPressed()
            if activeKeyHold == nil, let action = keyedMatch(keyCode, keyModifiers) {
                if action.isHold {
                    activeKeyHold = (action, keyCode)
                    out.append(.holdBegan(action))
                } else {
                    out.append(.pressed(action))
                }
            }
            return out
        case .keyUp(let keyCode):
            if let hold = activeKeyHold, hold.keyCode == keyCode {
                activeKeyHold = nil
                return [.holdEnded(hold.action)]
            }
            return []
        case .otherKey:
            return otherKeyPressed()
        case .reset:
            var out: [ShortcutTrigger] = []
            if let action = activeModifierHold { out.append(.holdCancelled(action)) }
            if let hold = activeKeyHold { out.append(.holdCancelled(hold.action)) }
            activeModifierHold = nil
            activeKeyHold = nil
            pending = nil
            modifiers = []
            heldModifierKeys = []
            dirty = false
            return out
        }
    }

    /// Starts a waiting hold once `armDelay` has passed.
    public mutating func tick(at now: Double) -> [ShortcutTrigger] {
        guard let waiting = pending, now >= waiting.since + delay(for: waiting.action), !dirty, activeModifierHold == nil else { return [] }
        pending = nil
        activeModifierHold = waiting.action
        return [.holdBegan(waiting.action)]
    }

    // MARK: - Rules

    private mutating func modifiersChanged(keyCode: UInt16, to newModifiers: Modifiers, at now: Double) -> [ShortcutTrigger] {
        trackModifierKey(keyCode, newModifiers)
        modifiers = newModifiers
        var out: [ShortcutTrigger] = []

        if modifiers.isEmpty {
            if let action = activeModifierHold { out.append(.holdEnded(action)) }
            activeModifierHold = nil
            pending = nil
            dirty = false
            return out
        }

        if let action = activeModifierHold, let combo = shortcuts[action], !matches(combo) {
            activeModifierHold = nil
            dirty = true // no other hold starts until every modifier is up
            // Fewer modifiers: one was let go, so send. More: another modifier joined, so it was not this shortcut.
            out.append(modifiers.isStrictSubset(of: combo.modifiers) ? .holdEnded(action) : .holdCancelled(action))
            pending = nil
            return out
        }

        if let waiting = pending, let combo = shortcuts[waiting.action], !matches(combo) {
            pending = nil
            // Another modifier joined before it started. Unless that makes a different shortcut (Right ⌥ on the
            // way to ⌃⌥), it was not a clean press: nothing starts until every modifier is up.
            if modifiers.isStrictSuperset(of: combo.modifiers), modifierOnlyMatch() == nil { dirty = true }
        }
        if !dirty, activeModifierHold == nil, activeKeyHold == nil, pending == nil,
           let action = modifierOnlyMatch() {
            pending = (action, now)
        }
        return out
    }

    /// Any non-modifier key, or a chord handled elsewhere: spoils a modifier-only hold.
    private mutating func otherKeyPressed() -> [ShortcutTrigger] {
        var out: [ShortcutTrigger] = []
        if let action = activeModifierHold {
            activeModifierHold = nil
            out.append(.holdCancelled(action))
        }
        pending = nil
        if !modifiers.isEmpty { dirty = true }
        return out
    }

    private mutating func trackModifierKey(_ keyCode: UInt16, _ newModifiers: Modifiers) {
        if let (modifier, _) = Self.modifierKeys[keyCode] {
            if !newModifiers.contains(modifier) {
                // This modifier is fully up: forget both sides.
                heldModifierKeys = heldModifierKeys.filter { Self.modifierKeys[$0]?.0 != modifier }
            } else if heldModifierKeys.contains(keyCode) {
                heldModifierKeys.remove(keyCode) // one side let go while the other is still down
            } else {
                heldModifierKeys.insert(keyCode)
            }
        }
        // Drop keys whose modifier is no longer down (a missed key-up).
        heldModifierKeys = heldModifierKeys.filter { key in
            guard let (modifier, _) = Self.modifierKeys[key] else { return false }
            return newModifiers.contains(modifier)
        }
    }

    /// Exactly this modifier-only shortcut is held now.
    private func matches(_ combo: KeyCombo) -> Bool {
        guard combo.isModifierOnly, modifiers == combo.modifiers else { return false }
        guard combo.rightSideOnly else { return true }
        let sides = heldModifierKeys.compactMap { Self.modifierKeys[$0] }.filter { combo.modifiers.contains($0.0) }.map(\.1)
        return sides.contains(.right) && !sides.contains(.left)
    }

    private func modifierOnlyMatch() -> ShortcutAction? {
        ShortcutAction.allCases.first { action in
            guard action.isHold, let combo = shortcuts[action] else { return false }
            return matches(combo)
        }
    }

    /// A keyed shortcut with fn (the others are system hot keys).
    private func keyedMatch(_ keyCode: UInt16, _ keyModifiers: Modifiers) -> ShortcutAction? {
        ShortcutAction.allCases.first { action in
            guard let combo = shortcuts[action], combo.keyCode == keyCode, Self.needsKeyTracking(combo) else { return false }
            return keyModifiers == combo.modifiers
        }
    }
}
