import Foundation

/// ARK's own folder under Application Support (2026-11-01). It is named by the bundle id, not "ARK": another app on Keshab's Mac
/// already keeps a Chromium profile in `Application Support/Ark`, and the disk ignores letter case, so "ARK" would be that folder.
public enum ArkFolders {
    public static let supportName = "dev.ark.island"

    public static func support(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent("Library/Application Support/\(supportName)", isDirectory: true)
    }
}
