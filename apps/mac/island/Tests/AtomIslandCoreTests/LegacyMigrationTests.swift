import Foundation
import Testing
@testable import AtomIslandCore

@Suite("LegacyMigration")
struct LegacyMigrationTests {
    private func suite() -> UserDefaults {
        let name = "atom.test.migration.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func mapsOldKeysToNewKeys() {
        #expect(LegacyMigration.newKey(forLegacy: "zeno.petEnabled") == "atom.petEnabled")
        #expect(LegacyMigration.newKey(forLegacy: "zeno.shortcut.talk") == "atom.shortcut.talk")
        #expect(LegacyMigration.newKey(forLegacy: "NSWindow Frame ZenoMain") == nil)
        #expect(LegacyMigration.newKey(forLegacy: "atom.petEnabled") == nil)
    }

    @Test func copiesEveryOldKeyOnceAndLeavesOthers() {
        let defaults = suite()
        let legacy: [String: Any] = ["zeno.petEnabled": false, "zeno.wisp.size": 2.5, "zeno.shortcut.talk": Data([1, 2]), "other": 1]
        #expect(LegacyMigration.migrateDefaults(into: defaults, legacy: legacy) == 3)
        #expect(defaults.object(forKey: "atom.petEnabled") as? Bool == false)
        #expect(defaults.double(forKey: "atom.wisp.size") == 2.5)
        #expect(defaults.data(forKey: "atom.shortcut.talk") == Data([1, 2]))
        #expect(defaults.object(forKey: "other") == nil)
        #expect(defaults.bool(forKey: LegacyMigration.flagKey))
        // The flag stops a second run, even with new old values.
        #expect(LegacyMigration.migrateDefaults(into: defaults, legacy: ["zeno.followUp": true]) == 0)
        #expect(defaults.object(forKey: "atom.followUp") == nil)
    }

    @Test func aValueAlreadySetUnderTheNewKeyWins() {
        let defaults = suite()
        defaults.set(true, forKey: "atom.petEnabled")
        LegacyMigration.migrateDefaults(into: defaults, legacy: ["zeno.petEnabled": false])
        #expect(defaults.bool(forKey: "atom.petEnabled"))
    }

    @Test func movesAFolderOnlyWhenTheNewOneIsAbsent() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("atom-migration-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: dir) }
        let old = dir.appendingPathComponent("ZENO", isDirectory: true)
        let new = dir.appendingPathComponent("ATOM", isDirectory: true)
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
        for key in keys { #expect(key.hasPrefix("atom.")) }
    }
}
