/// Changeable keyboard shortcuts (ADR-040): what a shortcut is, how it reads, and which ones are allowed.
/// The shortcut engine that listens for them is a later task (0.5.6).

/// Modifier keys, independent of AppKit so the model stays testable.
public struct Modifiers: OptionSet, Sendable, Hashable, Codable {
    public let rawValue: UInt8
    public init(rawValue: UInt8) { self.rawValue = rawValue }

    public static let control = Modifiers(rawValue: 1 << 0)
    public static let option = Modifiers(rawValue: 1 << 1)
    public static let shift = Modifiers(rawValue: 1 << 2)
    public static let command = Modifiers(rawValue: 1 << 3)
    public static let function = Modifiers(rawValue: 1 << 4)

    /// In the order macOS shows them: ⌃⌥⇧⌘, then fn.
    static let ordered: [(Modifiers, symbol: String, spoken: String)] = [
        (.control, "⌃", "Control"),
        (.option, "⌥", "Option"),
        (.shift, "⇧", "Shift"),
        (.command, "⌘", "Command"),
        (.function, "fn", "Fn"),
    ]

    /// How many modifiers are in the set.
    public var count: Int { rawValue.nonzeroBitCount }
}

/// A shortcut: modifiers with an optional key. Without a key it is modifier-only (e.g. hold ⌃⌥).
public struct KeyCombo: Sendable, Hashable, Codable {
    public var modifiers: Modifiers
    /// macOS virtual key code; nil = modifiers only.
    public var keyCode: UInt16?
    /// The key's label captured when recorded ("Z", "Space", "F5"). Display falls back to a built-in table.
    public var keyName: String?
    /// Modifier-only: only the right-hand modifier counts ("Right ⌥").
    public var rightSideOnly: Bool

    public init(modifiers: Modifiers, keyCode: UInt16? = nil, keyName: String? = nil, rightSideOnly: Bool = false) {
        self.modifiers = modifiers
        self.keyCode = keyCode
        self.keyName = keyName
        self.rightSideOnly = rightSideOnly
    }

    public var isModifierOnly: Bool { keyCode == nil }

    /// "⌃⌥", "⌃⌥Z", "Right ⌥", "Esc".
    public var display: String {
        let symbols = Modifiers.ordered.filter { modifiers.contains($0.0) }.map(\.symbol).joined()
        let side = isModifierOnly && rightSideOnly ? "Right " : ""
        return side + symbols + (keyLabel ?? "")
    }

    /// For VoiceOver: "Control Option Z", "Right Option".
    public var spokenDescription: String {
        var words = Modifiers.ordered.filter { modifiers.contains($0.0) }.map(\.spoken)
        if isModifierOnly && rightSideOnly { words.insert("Right", at: 0) }
        if let keyCode { words.append(KeyCodes.spokenNames[keyCode] ?? keyLabel ?? "Key \(keyCode)") }
        return words.joined(separator: " ")
    }

    /// The key's label: the recorded name, else the built-in table, else "Key 42".
    var keyLabel: String? {
        guard let keyCode else { return nil }
        if let keyName, !keyName.isEmpty { return keyName }
        return KeyCodes.names[keyCode] ?? "Key \(keyCode)"
    }

    /// Same keys, ignoring the recorded label (and the side, which only matters without a key).
    func sameKeys(as other: KeyCombo) -> Bool {
        modifiers == other.modifiers && keyCode == other.keyCode
            && (!isModifierOnly || rightSideOnly == other.rightSideOnly)
    }
}

/// macOS virtual key codes (ANSI US layout) and their labels.
enum KeyCodes {
    static let escape: UInt16 = 53
    static let space: UInt16 = 49

    static let functionKeys: [UInt16: String] = [
        122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10",
        103: "F11", 111: "F12", 105: "F13", 107: "F14", 113: "F15", 106: "F16", 64: "F17", 79: "F18", 80: "F19", 90: "F20",
    ]

    static let names: [UInt16: String] = {
        var names: [UInt16: String] = [
            0: "A", 11: "B", 8: "C", 2: "D", 14: "E", 3: "F", 5: "G", 4: "H", 34: "I", 38: "J", 40: "K", 37: "L", 46: "M",
            45: "N", 31: "O", 35: "P", 12: "Q", 15: "R", 1: "S", 17: "T", 32: "U", 9: "V", 13: "W", 7: "X", 16: "Y", 6: "Z",
            29: "0", 18: "1", 19: "2", 20: "3", 21: "4", 23: "5", 22: "6", 26: "7", 28: "8", 25: "9",
            49: "Space", 36: "Return", 48: "Tab", 53: "Esc", 51: "Delete",
            123: "←", 124: "→", 125: "↓", 126: "↑",
        ]
        names.merge(functionKeys) { a, _ in a }
        return names
    }()

    /// Where the spoken name differs from the label.
    static let spokenNames: [UInt16: String] = [
        53: "Escape", 123: "Left Arrow", 124: "Right Arrow", 125: "Down Arrow", 126: "Up Arrow",
    ]

    /// Letter keys, for the reserved-shortcut list.
    static let q: UInt16 = 12, w: UInt16 = 13, tab: UInt16 = 48, h: UInt16 = 4, m: UInt16 = 46
    static let c: UInt16 = 8, v: UInt16 = 9, x: UInt16 = 7, z: UInt16 = 6, a: UInt16 = 0, s: UInt16 = 1
}

/// What a shortcut does.
public enum ShortcutAction: String, Sendable, CaseIterable, Identifiable, Codable {
    case talk, dictate, toggleIsland, cancel

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .talk: "Talk to ZENO"
        case .dictate: "Dictate"
        case .toggleIsland: "Show or hide the island"
        case .cancel: "Cancel"
        }
    }

    public var detail: String {
        switch self {
        case .talk: "Hold, speak, let go to send"
        case .dictate: "Hold, speak, let go to type the text"
        case .toggleIsland: "Press to open or close"
        case .cancel: "Press while ZENO listens or speaks"
        }
    }

    /// Held while speaking, rather than pressed once.
    public var isHold: Bool { self == .talk || self == .dictate }

    public var defaultCombo: KeyCombo {
        switch self {
        case .talk: KeyCombo(modifiers: [.control, .option])
        case .dictate: KeyCombo(modifiers: [.command, .option], rightSideOnly: true)
        case .toggleIsland: KeyCombo(modifiers: [.control, .option], keyCode: KeyCodes.z, keyName: "Z")
        case .cancel: KeyCombo(modifiers: [], keyCode: KeyCodes.escape, keyName: "Esc")
        }
    }
}

/// Why a shortcut can't be used. `description` is shown under the recorder.
public enum ShortcutProblem: Error, Sendable, Equatable, CustomStringConvertible {
    case inUse(by: ShortcutAction)
    case needsModifier
    case needsKey
    case tooFewModifiers
    case reserved

    public var description: String {
        switch self {
        case .inUse(let action): "Already used for \(action.title)"
        case .needsModifier: "Add ⌃, ⌥ or ⌘"
        case .needsKey: "Add a key, e.g. ⌃⌥Z"
        case .tooFewModifiers: "Use two modifiers, e.g. ⌃⌥, or a right-hand key"
        case .reserved: "macOS or apps use this"
        }
    }
}

/// Checks a shortcut for `action` against the rules and the other actions' shortcuts. Nil = allowed.
public func validateShortcut(_ combo: KeyCombo, for action: ShortcutAction, others: [ShortcutAction: KeyCombo]) -> ShortcutProblem? {
    if combo.isModifierOnly {
        // Press actions fire on a key; a modifier on its own is only a hold.
        if !action.isHold { return .needsKey }
        // One modifier alone would fire during ordinary typing, except a right-hand key or fn.
        let count = combo.modifiers.count
        let allowed = count >= 2 || (count == 1 && combo.rightSideOnly) || combo.modifiers == .function
        if !allowed { return .tooFewModifiers }
    } else if let keyCode = combo.keyCode {
        // A plain key (with at most ⇧) would fire while typing.
        let strong: Modifiers = [.control, .option, .command, .function]
        let isFunctionKey = KeyCodes.functionKeys[keyCode] != nil
        let isCancelEscape = action == .cancel && keyCode == KeyCodes.escape
        if combo.modifiers.isDisjoint(with: strong) && !isFunctionKey && !isCancelEscape { return .needsModifier }
        if isReserved(combo.modifiers, keyCode) { return .reserved }
    }

    for other in ShortcutAction.allCases where other != action {
        if let otherCombo = others[other], conflicts(combo, otherCombo) { return .inUse(by: other) }
    }
    return nil
}

private func isReserved(_ modifiers: Modifiers, _ keyCode: UInt16) -> Bool {
    let commandKeys: Set<UInt16> = [
        KeyCodes.q, KeyCodes.w, KeyCodes.tab, KeyCodes.space, KeyCodes.h, KeyCodes.m,
        KeyCodes.c, KeyCodes.v, KeyCodes.x, KeyCodes.z, KeyCodes.a, KeyCodes.s,
    ]
    if modifiers == .command && commandKeys.contains(keyCode) { return true }
    if modifiers == .control && keyCode == KeyCodes.space { return true } // input source switching
    return false
}

/// Two shortcuts conflict when the same keys would trigger both.
private func conflicts(_ a: KeyCombo, _ b: KeyCombo) -> Bool {
    guard a.isModifierOnly && b.isModifierOnly else { return a.sameKeys(as: b) }
    // Same modifiers: a right-hand ⌥ is also a ⌥, so the side does not tell them apart.
    if a.modifiers == b.modifiers { return true }
    // Holding the larger set passes through the smaller one (⌃⌥ on the way to ⌃⌥⇧).
    // A single right-hand key or fn on its own is told apart by its side, so it may sit inside a
    // larger set: the defaults Right ⌥ (Dictate) and ⌃⌥ (Talk) coexist.
    let (smaller, larger) = a.modifiers.count < b.modifiers.count ? (a, b) : (b, a)
    return smaller.modifiers.count >= 2 && larger.modifiers.isSuperset(of: smaller.modifiers)
}
