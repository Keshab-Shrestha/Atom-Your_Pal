import Foundation
import Testing
@testable import ZenoIslandCore

@Suite("Shortcuts")
struct ShortcutTests {
    let controlOption = KeyCombo(modifiers: [.control, .option])
    let rightOption = KeyCombo(modifiers: .option, rightSideOnly: true)

    @Test func displaysModifiersInMacOSOrder() {
        #expect(KeyCombo(modifiers: [.command, .shift, .option, .control]).display == "⌃⌥⇧⌘")
        #expect(KeyCombo(modifiers: [.function, .command, .control], keyCode: 6).display == "⌃⌘fnZ")
        #expect(controlOption.display == "⌃⌥")
        #expect(KeyCombo(modifiers: [.option, .control], keyCode: 6).display == "⌃⌥Z")
        #expect(rightOption.display == "Right ⌥")
        #expect(KeyCombo(modifiers: [], keyCode: 53).display == "Esc")
        #expect(KeyCombo(modifiers: [], keyCode: 96).display == "F5")
        #expect(KeyCombo(modifiers: .command, keyCode: 49).display == "⌘Space")
        #expect(KeyCombo(modifiers: .control, keyCode: 126).display == "⌃↑")
        #expect(KeyCombo(modifiers: .control, keyCode: 200).display == "⌃Key 200")
    }

    @Test func aRecordedKeyNameWinsOverTheTable() {
        // On a French (AZERTY) keyboard the key at the US "Z" position is labelled "W".
        #expect(KeyCombo(modifiers: [.control, .option], keyCode: 6, keyName: "W").display == "⌃⌥W")
        #expect(KeyCombo(modifiers: .control, keyCode: 6, keyName: "").display == "⌃Z") // empty: use the table
        #expect(KeyCombo(modifiers: .option, keyCode: 6, rightSideOnly: true).display == "⌥Z") // side matters only without a key
    }

    @Test func spokenDescriptions() {
        #expect(KeyCombo(modifiers: [.control, .option], keyCode: 6).spokenDescription == "Control Option Z")
        #expect(rightOption.spokenDescription == "Right Option")
        #expect(KeyCombo(modifiers: [], keyCode: 53).spokenDescription == "Escape")
        #expect(KeyCombo(modifiers: [.shift, .command], keyCode: 123).spokenDescription == "Shift Command Left Arrow")
    }

    @Test func modifierOnly() {
        #expect(controlOption.isModifierOnly)
        #expect(!KeyCombo(modifiers: .control, keyCode: 6).isModifierOnly)
    }

    @Test func survivesEncoding() throws {
        for combo in ShortcutAction.allCases.map(\.defaultCombo) + [KeyCombo(modifiers: [.shift, .function], keyCode: 96, keyName: "F5")] {
            let data = try JSONEncoder().encode(combo)
            #expect(try JSONDecoder().decode(KeyCombo.self, from: data) == combo)
        }
    }

    @Test func actionsDescribeThemselves() {
        #expect(ShortcutAction.allCases.map(\.title) == ["Talk to ZENO", "Dictate", "Show or hide the island", "Cancel"])
        #expect(ShortcutAction.talk.detail == "Hold, speak, let go to send")
        #expect(ShortcutAction.allCases.filter(\.isHold) == [.talk, .dictate])
        #expect(ShortcutAction.talk.defaultCombo == controlOption)
        #expect(ShortcutAction.dictate.defaultCombo.display == "Right ⌥⌘") // macOS order: ⌥ before ⌘
        #expect(ShortcutAction.toggleIsland.defaultCombo.display == "⌃⌥Z")
        #expect(ShortcutAction.cancel.defaultCombo.display == "Esc")
    }

    @Test func theDefaultsAreValidTogether() {
        let defaults = Dictionary(uniqueKeysWithValues: ShortcutAction.allCases.map { ($0, $0.defaultCombo) })
        for action in ShortcutAction.allCases {
            #expect(validateShortcut(action.defaultCombo, for: action, others: defaults) == nil, "\(action)")
        }
    }

    @Test func plainKeysNeedAModifier() {
        func check(_ combo: KeyCombo, _ action: ShortcutAction = .toggleIsland) -> ShortcutProblem? {
            validateShortcut(combo, for: action, others: [:])
        }
        #expect(check(KeyCombo(modifiers: [], keyCode: 6)) == .needsModifier)          // Z
        #expect(check(KeyCombo(modifiers: .shift, keyCode: 6)) == .needsModifier)      // ⇧Z types a capital
        #expect(check(KeyCombo(modifiers: [], keyCode: 49)) == .needsModifier)         // Space
        #expect(check(KeyCombo(modifiers: [], keyCode: 18)) == .needsModifier)         // 1
        #expect(check(KeyCombo(modifiers: [], keyCode: 126)) == .needsModifier)        // ↑
        #expect(check(KeyCombo(modifiers: [], keyCode: 53)) == .needsModifier)         // Esc is only for Cancel
        #expect(check(KeyCombo(modifiers: [], keyCode: 53), .cancel) == nil)
        #expect(check(KeyCombo(modifiers: [], keyCode: 96)) == nil)                    // F5
        #expect(check(KeyCombo(modifiers: [], keyCode: 90), .talk) == nil)             // F20, held
        #expect(check(KeyCombo(modifiers: .function, keyCode: 6)) == nil)
        #expect(check(KeyCombo(modifiers: .command, keyCode: 6, keyName: "Z")) == .reserved)
        #expect(ShortcutProblem.needsModifier.description == "Add ⌃, ⌥ or ⌘")
    }

    @Test func pressActionsNeedAKey() {
        #expect(validateShortcut(controlOption, for: .toggleIsland, others: [:]) == .needsKey)
        #expect(validateShortcut(controlOption, for: .cancel, others: [:]) == .needsKey)
        #expect(ShortcutProblem.needsKey.description == "Add a key, e.g. ⌃⌥Z")
    }

    @Test func modifierOnlyNeedsTwoModifiersOrARightHandKey() {
        func check(_ combo: KeyCombo) -> ShortcutProblem? { validateShortcut(combo, for: .talk, others: [:]) }
        #expect(check(KeyCombo(modifiers: .option)) == .tooFewModifiers)
        #expect(check(KeyCombo(modifiers: .command)) == .tooFewModifiers)
        #expect(check(KeyCombo(modifiers: [])) == .tooFewModifiers)
        #expect(check(KeyCombo(modifiers: .command, rightSideOnly: true)) == nil)
        #expect(check(KeyCombo(modifiers: .function)) == nil)
        #expect(check(KeyCombo(modifiers: [.command, .shift])) == nil)
        #expect(ShortcutProblem.tooFewModifiers.description == "Use two modifiers, e.g. ⌃⌥, or a right-hand key")
    }

    @Test func systemShortcutsAreReserved() {
        let commandKeys: [UInt16] = [12, 13, 48, 49, 4, 46, 8, 9, 7, 6, 0, 1] // Q W Tab Space H M C V X Z A S
        for key in commandKeys {
            #expect(validateShortcut(KeyCombo(modifiers: .command, keyCode: key), for: .toggleIsland, others: [:]) == .reserved, "⌘\(key)")
        }
        #expect(validateShortcut(KeyCombo(modifiers: .control, keyCode: 49), for: .toggleIsland, others: [:]) == .reserved)
        #expect(validateShortcut(KeyCombo(modifiers: [.command, .shift], keyCode: 12), for: .toggleIsland, others: [:]) == nil)
        #expect(validateShortcut(KeyCombo(modifiers: .command, keyCode: 17), for: .toggleIsland, others: [:]) == nil) // ⌘T
        #expect(ShortcutProblem.reserved.description == "macOS or apps use this")
    }

    @Test func refusesAShortcutAnotherActionUses() {
        let others: [ShortcutAction: KeyCombo] = [.talk: controlOption, .toggleIsland: KeyCombo(modifiers: [.control, .option], keyCode: 6, keyName: "Z")]
        #expect(validateShortcut(controlOption, for: .dictate, others: others) == .inUse(by: .talk))
        // The recorded label does not make it a different shortcut.
        #expect(validateShortcut(KeyCombo(modifiers: [.control, .option], keyCode: 6, keyName: "W"), for: .cancel, others: others) == .inUse(by: .toggleIsland))
        // The action's own current shortcut is not a conflict.
        #expect(validateShortcut(controlOption, for: .talk, others: others) == nil)
        #expect(ShortcutProblem.inUse(by: .talk).description == "Already used for Talk to ZENO")
    }

    @Test func modifierOnlyShortcutsInsideEachOtherConflict() {
        let others: [ShortcutAction: KeyCombo] = [.talk: controlOption]
        #expect(validateShortcut(KeyCombo(modifiers: [.control, .option, .shift]), for: .dictate, others: others) == .inUse(by: .talk))
        #expect(validateShortcut(KeyCombo(modifiers: [.control, .option, .shift]), for: .talk, others: [.dictate: controlOption]) == .inUse(by: .dictate))
        #expect(validateShortcut(KeyCombo(modifiers: [.control, .shift]), for: .dictate, others: others) == nil)
        // A chord with a key is not held through, so it does not conflict with a modifier-only one.
        #expect(validateShortcut(KeyCombo(modifiers: [.control, .option], keyCode: 6), for: .toggleIsland, others: others) == nil)
    }

    @Test func aRightHandKeyConflictsWithTheSameKeyOnEitherSide() {
        let leftOrRight = KeyCombo(modifiers: [.option, .command])
        let rightOnly = KeyCombo(modifiers: [.option, .command], rightSideOnly: true)
        #expect(validateShortcut(rightOnly, for: .dictate, others: [.talk: leftOrRight]) == .inUse(by: .talk))
        #expect(validateShortcut(rightOption, for: .dictate, others: [.talk: rightOption]) == .inUse(by: .talk))
        // Right ⌥ alone is told apart from ⌃⌥ by its side: the defaults coexist.
        #expect(validateShortcut(rightOption, for: .dictate, others: [.talk: controlOption]) == nil)
    }
}

@Suite("IslandSettings")
@MainActor
final class IslandSettingsTests {
    /// A fresh store per test, removed afterwards.
    let suiteName = "zeno.tests.\(UUID().uuidString)"
    var defaults: UserDefaults { UserDefaults(suiteName: suiteName)! }

    deinit { UserDefaults().removePersistentDomain(forName: suiteName) }

    let f5 = KeyCombo(modifiers: [], keyCode: 96, keyName: "F5")

    @Test func startsWithTheDefaults() {
        let settings = IslandSettings(defaults: defaults)
        for action in ShortcutAction.allCases {
            #expect(settings.shortcut(for: action) == action.defaultCombo)
        }
        #expect(settings.shortcuts.count == ShortcutAction.allCases.count)
        #expect(settings.petEnabled && settings.soundsEnabled)
        #expect(settings.petSpot == nil)
        #expect(settings.revision == 0)
    }

    @Test func remembersWherePalWasParked() {
        let first = IslandSettings(defaults: defaults)
        first.petSpot = PetSpot(x: 1234.5, y: 410)
        #expect(IslandSettings(defaults: defaults).petSpot == PetSpot(x: 1234.5, y: 410))
        first.petSpot = nil
        #expect(IslandSettings(defaults: defaults).petSpot == nil)
    }

    @Test func ignoresAnUnreadablePetSpot() {
        let store = defaults
        store.set("not a point", forKey: IslandSettings.petSpotKey)
        #expect(IslandSettings(defaults: store).petSpot == nil)
        store.set([1.0, 2.0, 3.0], forKey: IslandSettings.petSpotKey)
        #expect(IslandSettings(defaults: store).petSpot == nil)
        store.set([Double.nan, 2.0], forKey: IslandSettings.petSpotKey)
        #expect(IslandSettings(defaults: store).petSpot == nil)
    }

    @Test func setsClearsAndResets() {
        let settings = IslandSettings(defaults: defaults)
        #expect(settings.setShortcut(f5, for: .toggleIsland) == nil)
        #expect(settings.shortcut(for: .toggleIsland) == f5)

        #expect(settings.setShortcut(nil, for: .dictate) == nil)
        #expect(settings.shortcut(for: .dictate) == nil)
        #expect(settings.shortcuts[.dictate] == nil && settings.shortcuts.count == 3)

        settings.resetShortcut(for: .dictate)
        #expect(settings.shortcut(for: .dictate) == ShortcutAction.dictate.defaultCombo)

        _ = settings.setShortcut(nil, for: .talk)
        settings.resetAllShortcuts()
        for action in ShortcutAction.allCases {
            #expect(settings.shortcut(for: action) == action.defaultCombo)
        }
    }

    @Test func refusedShortcutsAreNotStored() {
        let settings = IslandSettings(defaults: defaults)
        let talk = ShortcutAction.talk.defaultCombo
        #expect(settings.setShortcut(talk, for: .dictate) == .inUse(by: .talk))
        #expect(settings.shortcut(for: .dictate) == ShortcutAction.dictate.defaultCombo)
        #expect(settings.setShortcut(KeyCombo(modifiers: [], keyCode: 6), for: .toggleIsland) == .needsModifier)
        #expect(settings.revision == 0)
        // A cleared shortcut no longer blocks others.
        _ = settings.setShortcut(nil, for: .talk)
        #expect(settings.setShortcut(talk, for: .dictate) == nil)
    }

    @Test func persistsAcrossLaunches() {
        let first = IslandSettings(defaults: defaults)
        _ = first.setShortcut(f5, for: .toggleIsland)
        _ = first.setShortcut(nil, for: .cancel)
        first.petEnabled = false
        first.soundsEnabled = false

        let second = IslandSettings(defaults: defaults)
        #expect(second.shortcut(for: .toggleIsland) == f5)
        #expect(second.shortcut(for: .cancel) == nil) // cleared, not back to the default
        #expect(second.shortcut(for: .talk) == ShortcutAction.talk.defaultCombo)
        #expect(!second.petEnabled && !second.soundsEnabled)

        second.resetAllShortcuts()
        second.petEnabled = true
        let third = IslandSettings(defaults: defaults)
        #expect(third.shortcut(for: .cancel) == ShortcutAction.cancel.defaultCombo)
        #expect(third.petEnabled && !third.soundsEnabled)
    }

    @Test func storesOneKeyPerSetting() {
        let store = defaults
        let settings = IslandSettings(defaults: store)
        _ = settings.setShortcut(f5, for: .toggleIsland)
        _ = settings.setShortcut(nil, for: .cancel)
        settings.petEnabled = false
        #expect(store.data(forKey: "zeno.shortcut.toggleIsland") != nil)
        #expect(store.object(forKey: "zeno.shortcut.cancel") != nil)
        #expect(store.object(forKey: "zeno.shortcut.talk") == nil) // never set
        #expect(store.object(forKey: "zeno.petEnabled") as? Bool == false)
    }

    @Test func corruptDataFallsBackToTheDefault() {
        let store = defaults
        store.set(Data("not json".utf8), forKey: "zeno.shortcut.talk")
        store.set(42, forKey: "zeno.shortcut.dictate")
        store.set("something else", forKey: "zeno.shortcut.cancel")
        store.set("yes", forKey: "zeno.petEnabled")
        let settings = IslandSettings(defaults: store)
        #expect(settings.shortcut(for: .talk) == ShortcutAction.talk.defaultCombo)
        #expect(settings.shortcut(for: .dictate) == ShortcutAction.dictate.defaultCombo)
        #expect(settings.shortcut(for: .cancel) == ShortcutAction.cancel.defaultCombo)
        #expect(settings.petEnabled)
        #expect(settings.unreadableShortcuts == [.talk, .dictate, .cancel])
    }

    @Test func everyChangeBumpsTheRevision() {
        let settings = IslandSettings(defaults: defaults)
        _ = settings.setShortcut(f5, for: .toggleIsland)
        #expect(settings.revision == 1)
        _ = settings.setShortcut(nil, for: .toggleIsland)
        #expect(settings.revision == 2)
        settings.resetShortcut(for: .toggleIsland)
        #expect(settings.revision == 3)
        settings.resetAllShortcuts()
        #expect(settings.revision == 4)
        settings.petEnabled = false
        #expect(settings.revision == 5)
        settings.soundsEnabled = false
        #expect(settings.revision == 6)
    }
}
