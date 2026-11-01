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

    /// The launch step: settings from the old bundle ids, and the Application Support and Logs folders. Application Support goes to
    /// `ArkFolders.support` (named by the bundle id: "ARK" is another app's folder on this Mac); Logs goes to `Logs/ARK`.
    public static func run(defaults: UserDefaults = .standard, home: URL = FileManager.default.homeDirectoryForCurrentUser) {
        var legacy: [String: Any] = [:]
        for old in oldNames {
            legacy.merge(defaults.persistentDomain(forName: old.domain) ?? [:]) { kept, _ in kept }
        }
        migrateDefaults(into: defaults, legacy: legacy)
        let support = home.appendingPathComponent("Library/Application Support", isDirectory: true)
        let logs = home.appendingPathComponent("Library/Logs", isDirectory: true)
        for old in oldNames {
            moveFolder(from: support.appendingPathComponent(old.folder, isDirectory: true), to: ArkFolders.support(home: home))
            moveFolder(from: logs.appendingPathComponent(old.folder, isDirectory: true), to: logs.appendingPathComponent("ARK", isDirectory: true))
        }
    }

    /// The project's log under the old names, `logs/atom.log` or `logs/zeno.log`, becomes `logs/ark.log` when that is not there yet.
    /// Runs before the app opens its own log: the app starts before the runtime, so the runtime's own rename came too late.
    public static func moveLog(inProject directory: URL) {
        let logs = directory.appendingPathComponent("logs", isDirectory: true)
        for name in ["atom.log", "zeno.log"] {
            moveFolder(from: logs.appendingPathComponent(name), to: logs.appendingPathComponent("ark.log"))
        }
    }
}
