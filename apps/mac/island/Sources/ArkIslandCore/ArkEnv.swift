import Foundation

/// `ARK_<x>` is the name of an environment variable (2026-11-01). The old names, `ATOM_<x>` (ADR-105) and `ZENO_<x>` before it,
/// are read in that order when `ARK_<x>` is not set. Empty counts as unset. Pass the `ARK_` name.
public enum ArkEnv {
    private static let prefix = "ARK_"
    private static let legacyPrefixes = ["ATOM_", "ZENO_"]

    public static func read(_ name: String, _ env: [String: String] = ProcessInfo.processInfo.environment) -> String? {
        if let value = env[name], !value.isEmpty { return value }
        guard name.hasPrefix(prefix) else { return nil }
        for legacy in legacyPrefixes {
            if let old = env[legacy + name.dropFirst(prefix.count)], !old.isEmpty { return old }
        }
        return nil
    }
}
