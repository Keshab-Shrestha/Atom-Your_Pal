import AppKit
import Observation
import AtomIslandCore

/// Records a new shortcut in Settings (ADR-040). While recording, every key goes to the recorder:
/// press the new keys, or hold modifiers and let go for a hold shortcut (e.g. ⌃⌥, Right ⌥).
/// Esc cancels (except for the Cancel action, whose default is Esc: click the recorder again instead).
/// Delete clears the shortcut, which turns the action off.
@MainActor @Observable
final class ShortcutRecorder {
    /// The action being recorded, if any.
    private(set) var action: ShortcutAction?
    /// Modifiers held right now, shown live while recording.
    private(set) var held: Modifiers = []
    /// Why the last attempt was refused, shown under that action's row until the next attempt.
    private(set) var problem: (action: ShortcutAction, message: String)?

    @ObservationIgnored private let settings: IslandSettings
    /// The most modifiers held at once since all were last released.
    @ObservationIgnored private var peak: Modifiers = []
    /// The single modifier in `peak` was pressed with its right-hand key.
    @ObservationIgnored private var peakRightHand = false
    @ObservationIgnored private var keyPressedSinceRelease = false

    /// Key codes of the right-hand modifier keys: Right ⌘, Right ⇧, Right ⌥, Right ⌃.
    private static let rightHandKeys: Set<UInt16> = [54, 60, 61, 62]
    private static let escape: UInt16 = 53
    private static let deleteKeys: Set<UInt16> = [51, 117]

    init(settings: IslandSettings) {
        self.settings = settings
    }

    var isRecording: Bool { action != nil }

    func toggle(_ action: ShortcutAction) {
        if self.action == action { stop() } else { start(action) }
    }

    func start(_ action: ShortcutAction) {
        self.action = action
        problem = nil
        held = []
        peak = []
        peakRightHand = false
        keyPressedSinceRelease = false
    }

    func stop() {
        action = nil
        held = []
    }

    /// Handles a key event while recording. Returns true when the event was used and must not reach anything else.
    func handle(_ event: NSEvent) -> Bool {
        guard let action else { return false }
        switch event.type {
        case .flagsChanged:
            let now = Self.modifiers(event.modifierFlags)
            held = now
            if now.isEmpty {
                // Everything released: modifiers alone, with no key in between, make a hold shortcut.
                if !peak.isEmpty && !keyPressedSinceRelease {
                    commit(KeyCombo(modifiers: peak, rightSideOnly: peak.count == 1 && peakRightHand), for: action)
                }
                peak = []
                peakRightHand = false
                keyPressedSinceRelease = false
            } else if now.isStrictSuperset(of: peak) {
                if peak.isEmpty { peakRightHand = Self.rightHandKeys.contains(event.keyCode) }
                peak = now
            }
            return true

        case .keyDown:
            if event.isARepeat { return true }
            // fn is set by macOS for arrows and F-keys on their own; it is not part of a keyed shortcut.
            let modifiers = Self.modifiers(event.modifierFlags).subtracting(.function)
            keyPressedSinceRelease = true
            if modifiers.isEmpty && event.keyCode == Self.escape && action != .cancel {
                stop()
                return true
            }
            if modifiers.isEmpty && Self.deleteKeys.contains(event.keyCode) {
                commit(nil, for: action)
                return true
            }
            commit(KeyCombo(modifiers: modifiers, keyCode: event.keyCode, keyName: Self.keyName(event)), for: action)
            return true

        case .keyUp:
            return true

        default:
            return false
        }
    }

    private func commit(_ combo: KeyCombo?, for action: ShortcutAction) {
        if let refused = settings.setShortcut(combo, for: action) {
            problem = (action, refused.description) // keep recording so the user can try again
        } else {
            problem = nil
            stop()
        }
    }

    static func modifiers(_ flags: NSEvent.ModifierFlags) -> Modifiers {
        var result: Modifiers = []
        if flags.contains(.control) { result.insert(.control) }
        if flags.contains(.option) { result.insert(.option) }
        if flags.contains(.shift) { result.insert(.shift) }
        if flags.contains(.command) { result.insert(.command) }
        if flags.contains(.function) { result.insert(.function) }
        return result
    }

    /// The key's label on the current keyboard layout, for printable keys. Special keys (arrows, F-keys,
    /// Return…) return nil so the built-in names are used.
    private static func keyName(_ event: NSEvent) -> String? {
        guard let characters = event.charactersIgnoringModifiers, characters.count == 1,
              let scalar = characters.unicodeScalars.first,
              scalar.value >= 0x21, scalar.value < 0xF700, // printable, not a function-key private-use code
              !CharacterSet.controlCharacters.contains(scalar)
        else { return nil }
        return characters.uppercased()
    }
}
