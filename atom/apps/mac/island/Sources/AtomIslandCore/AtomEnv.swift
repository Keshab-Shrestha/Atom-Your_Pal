import Foundation

/// ADR-105: `ATOM_<x>` is the name of an environment variable; `ZENO_<x>` is the old name, read when
/// `ATOM_<x>` is not set. Empty counts as unset. Pass the `ATOM_` name.
public enum AtomEnv {
    private static let prefix = "ATOM_"
    private static let legacyPrefix = "ZENO_"

    public static func read(_ name: String, _ env: [String: String] = ProcessInfo.processInfo.environment) -> String? {
        if let value = env[name], !value.isEmpty { return value }
        guard name.hasPrefix(prefix) else { return nil }
        let old = env[legacyPrefix + name.dropFirst(prefix.count)]
        return (old?.isEmpty ?? true) ? nil : old
    }
}
