import Foundation

// Update ARK from Settings (2026-11-04, idea from atticus-mac "git self-updater"). A copy built from source (the installer puts it in
// ~/ARK) is a git folder: ARK looks at origin/main, says how many changes wait, and on the user's click pulls them (fast-forward only)
// and runs the same build as the installer. This file holds the plain parts, so they are unit-tested; the app runs git.

public enum UpdateStatus: Sendable, Equatable {
    /// Not a source copy (a download, or a development build): update with the installer or by hand.
    case notASourceCopy
    case upToDate
    case available(count: Int, subjects: [String])
    /// Why this copy cannot update by itself: it has changes of its own, or sits on another branch.
    case blocked(String)
    case failed(String)
}

public enum AppUpdate {
    public static let branch = "main"
    public static let maxSubjects = 5

    /// The source folder of an installed app: `<root>/apps/mac/island/build/ARK.app`. Nil for any other place.
    public static func sourceRoot(bundle: URL) -> URL? {
        let parts = bundle.standardizedFileURL.pathComponents
        guard parts.suffix(5) == ["apps", "mac", "island", "build", "ARK.app"] else { return nil }
        return URL(fileURLWithPath: NSString.path(withComponents: Array(parts.dropLast(5))), isDirectory: true)
    }

    /// What `git` said, as a status. `behind`: commits on origin/main that this copy lacks; `subjects`: their first lines, newest first.
    public static func status(branch current: String, dirty: Bool, behind: Int, subjects: [String]) -> UpdateStatus {
        if current != branch { return .blocked("This copy is on the branch “\(current)”, not “\(branch)”. Update it by hand.") }
        if dirty { return .blocked("This copy has changes of its own. Update it by hand so they are not lost.") }
        if behind <= 0 { return .upToDate }
        let clean = subjects.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.prefix(maxSubjects).map { String($0.prefix(120)) }
        return .available(count: behind, subjects: Array(clean))
    }

    /// The shell line that updates: fast-forward only, then the installer's build, which reopens ARK. Output goes to `logs/update.log`.
    public static func updateCommand(root: URL) -> String {
        let folder = shellQuoted(root.path)
        return "cd \(folder) && mkdir -p logs && { git pull --ff-only && sh scripts/setup.sh; } > logs/update.log 2>&1"
    }

    static func shellQuoted(_ text: String) -> String { "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'" }
}
