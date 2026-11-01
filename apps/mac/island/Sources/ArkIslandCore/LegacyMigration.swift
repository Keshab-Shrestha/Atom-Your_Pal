import Foundation

/// The app's name is ARK (2026-11-01). It was ATOM (ADR-105), and ZENO before that. On first launch it brings the settings and
/// folders of the old names along, the newer name first. The old ones stay where they are, so a failed or unwanted move loses nothing.
public enum LegacyMigration {
    public struct OldName: Sendable {
        /// The bundle id the app had; its UserDefaults domain holds that name's settings.
        public let domain: String
        public let prefix: String
        /// The folder name under Application Support and Logs.
        public let folder: String
    }

    /// Newest first: a setting under `atom.` wins over the same one under `zeno.`.
    public static let oldNames = [
        OldName(domain: "dev.atom.island", prefix: "atom.", folder: "ATOM"),
        OldName(domain: "dev.zeno.island", prefix: "zeno.", folder: "ZENO"),
    ]
    public static let newPrefix = "ark."
    /// Set once the copy has run, so it never runs twice.
    public static let flagKey = "ark.migrated"

    /// `atom.petEnabled` and `zeno.petEnabled` become `ark.petEnabled`. Nil for a key that is not an old setting, or that is an
    /// old name's own "migrated" flag.
    public static func newKey(forLegacy key: String) -> String? {
        guard let old = oldNames.first(where: { key.hasPrefix($0.prefix) }) else { return nil }
        let rest = key.dropFirst(old.prefix.count)
        return rest == "migrated" ? nil : newPrefix + rest
    }

    /// Copies every old-name value of `legacy` to `ark.*` in `defaults`, once. A value already set under the new key wins, and
    /// the newer old name wins over the older one. Returns the number of keys copied; 0 when the flag was already set.
    @discardableResult
    public static func migrateDefaults(into defaults: UserDefaults, legacy: [String: Any]) -> Int {
        if defaults.bool(forKey: flagKey) { return 0 }
        let rank = { (key: String) in oldNames.firstIndex(where: { key.hasPrefix($0.prefix) }) ?? oldNames.count }
        var copied = 0
        for key in legacy.keys.sorted(by: { (rank($0), $0) < (rank($1), $1) }) {
            guard let target = newKey(forLegacy: key), defaults.object(forKey: target) == nil else { continue }
            defaults.set(legacy[key], forKey: target)
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

    /// The launch step: settings from the old bundle ids, and the Application Support and Logs folders.
    public static func run(defaults: UserDefaults = .standard, home: URL = FileManager.default.homeDirectoryForCurrentUser) {
        var legacy: [String: Any] = [:]
        for old in oldNames {
            legacy.merge(defaults.persistentDomain(forName: old.domain) ?? [:]) { kept, _ in kept }
        }
        migrateDefaults(into: defaults, legacy: legacy)
        for folder in ["Library/Application Support", "Library/Logs"] {
            let base = home.appendingPathComponent(folder, isDirectory: true)
            for old in oldNames {
                moveFolder(from: base.appendingPathComponent(old.folder, isDirectory: true), to: base.appendingPathComponent("ARK", isDirectory: true))
            }
        }
    }
}
