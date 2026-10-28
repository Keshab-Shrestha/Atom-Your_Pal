import Foundation

/// ADR-105: the app moved from the name ZENO to ATOM. On first launch it brings the old settings and folders along.
/// The old ones stay where they are, so a failed or unwanted move loses nothing.
public enum LegacyMigration {
    /// The bundle id the app had under the old name; its UserDefaults domain holds the old settings.
    public static let legacyDomain = "dev.zeno.island"
    public static let legacyPrefix = "zeno."
    public static let newPrefix = "atom."
    /// Set once the copy has run, so it never runs twice.
    public static let flagKey = "atom.migrated"

    /// `zeno.petEnabled` becomes `atom.petEnabled`. Nil for a key that is not an old ATOM setting.
    public static func newKey(forLegacy key: String) -> String? {
        key.hasPrefix(legacyPrefix) ? newPrefix + key.dropFirst(legacyPrefix.count) : nil
    }

    /// Copies every `zeno.*` value of `legacy` to `atom.*` in `defaults`, once. A value already set under the new key wins.
    /// Returns the number of keys copied; 0 when the flag was already set.
    @discardableResult
    public static func migrateDefaults(into defaults: UserDefaults, legacy: [String: Any]) -> Int {
        if defaults.bool(forKey: flagKey) { return 0 }
        var copied = 0
        for (key, value) in legacy {
            guard let target = newKey(forLegacy: key), defaults.object(forKey: target) == nil else { continue }
            defaults.set(value, forKey: target)
            copied += 1
        }
        defaults.set(true, forKey: flagKey)
        return copied
    }

    /// Moves `old` to `new` when `old` exists and `new` does not. Returns true if it moved. A failure leaves `old` in place.
    @discardableResult
    public static func moveFolder(from old: URL, to new: URL, fileManager fm: FileManager = .default) -> Bool {
        guard fm.fileExists(atPath: old.path), !fm.fileExists(atPath: new.path) else { return false }
        do {
            try fm.moveItem(at: old, to: new)
            return true
        } catch {
            return false
        }
    }

    /// The launch step: settings from the old bundle id, and the Application Support and Logs folders.
    public static func run(defaults: UserDefaults = .standard, home: URL = FileManager.default.homeDirectoryForCurrentUser) {
        migrateDefaults(into: defaults, legacy: defaults.persistentDomain(forName: legacyDomain) ?? [:])
        for folder in ["Library/Application Support", "Library/Logs"] {
            let base = home.appendingPathComponent(folder, isDirectory: true)
            moveFolder(from: base.appendingPathComponent("ZENO", isDirectory: true), to: base.appendingPathComponent("ATOM", isDirectory: true))
        }
    }
}
