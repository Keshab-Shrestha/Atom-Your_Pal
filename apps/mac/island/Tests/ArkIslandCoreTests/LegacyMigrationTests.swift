import Foundation
import Testing
@testable import ArkIslandCore

@Suite("LegacyMigration")
struct LegacyMigrationTests {
    private func suite() -> UserDefaults {
        let name = "ark.test.migration.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func mapsOldKeysToNewKeys() {
        #expect(LegacyMigration.newKey(forLegacy: "atom.petEnabled") == "ark.petEnabled")
        #expect(LegacyMigration.newKey(forLegacy: "zeno.shortcut.talk") == "ark.shortcut.talk")
        #expect(LegacyMigration.newKey(forLegacy: "atom.migrated") == nil, "an old name's own flag is not a setting")
        #expect(LegacyMigration.newKey(forLegacy: "NSWindow Frame ZenoMain") == nil)
        #expect(LegacyMigration.newKey(forLegacy: "ark.petEnabled") == nil)
    }

    @Test func copiesEveryOldKeyOnceAndLeavesOthers() {
        let defaults = suite()
        let legacy: [String: Any] = ["atom.petEnabled": false, "zeno.wisp.size": 2.5, "atom.shortcut.talk": Data([1, 2]), "atom.migrated": true, "other": 1]
        #expect(LegacyMigration.migrateDefaults(into: defaults, legacy: legacy) == 3)
        #expect(defaults.object(forKey: "ark.petEnabled") as? Bool == false)
        #expect(defaults.double(forKey: "ark.wisp.size") == 2.5)
        #expect(defaults.data(forKey: "ark.shortcut.talk") == Data([1, 2]))
        #expect(defaults.object(forKey: "other") == nil)
        #expect(defaults.bool(forKey: LegacyMigration.flagKey))
        // The flag stops a second run, even with new old values.
        #expect(LegacyMigration.migrateDefaults(into: defaults, legacy: ["atom.followUp": true]) == 0)
        #expect(defaults.object(forKey: "ark.followUp") == nil)
    }

    @Test func theNewerOldNameWins() {
        let defaults = suite()
        LegacyMigration.migrateDefaults(into: defaults, legacy: ["zeno.theme": "old", "atom.theme": "newer"])
        #expect(defaults.string(forKey: "ark.theme") == "newer")
    }

    @Test func aValueAlreadySetUnderTheNewKeyWins() {
        let defaults = suite()
        defaults.set(true, forKey: "ark.petEnabled")
        LegacyMigration.migrateDefaults(into: defaults, legacy: ["atom.petEnabled": false])
        #expect(defaults.bool(forKey: "ark.petEnabled"))
    }

    @Test func movesAFolderOnlyWhenTheNewOneIsAbsent() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("ark-migration-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: dir) }
        let old = dir.appendingPathComponent("ATOM", isDirectory: true)
        let new = dir.appendingPathComponent("ARK", isDirectory: true)
        try fm.createDirectory(at: old, withIntermediateDirectories: true)
        try Data("x".utf8).write(to: old.appendingPathComponent("vocabulary.txt"))

        #expect(LegacyMigration.moveFolder(from: old, to: new))
        #expect(fm.fileExists(atPath: new.appendingPathComponent("vocabulary.txt").path))
        #expect(!fm.fileExists(atPath: old.path))

        try fm.createDirectory(at: old, withIntermediateDirectories: true)
        #expect(!LegacyMigration.moveFolder(from: old, to: new)) // new exists: old stays
        #expect(fm.fileExists(atPath: old.path))
    }

    @MainActor @Test func everySettingKeyInTheCodeUsesTheNewPrefix() {
        let keys = [IslandSettings.petKey, IslandSettings.soundsKey, IslandSettings.themeKey, IslandSettings.tourDoneKey,
                    IslandSettings.dictationModeKey, IslandSettings.shortcutKey(.talk)]
        for key in keys { #expect(key.hasPrefix("ark.")) }
    }
}
