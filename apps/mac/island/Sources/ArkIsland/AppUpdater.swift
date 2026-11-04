import Foundation
import Observation
import ArkIslandCore

/// Update ARK from Settings → General (2026-11-04). Runs `git` in the source folder of this copy: look (fetch, count), then on the
/// user's click pull (fast-forward only) and rebuild, which reopens ARK. A copy that is not a source copy says so and does nothing.
@MainActor @Observable
final class AppUpdater {
    private(set) var status: UpdateStatus?
    private(set) var checking = false
    private(set) var updating = false
    private var checkedAt = Date.distantPast
    private let root = AppUpdate.sourceRoot(bundle: Bundle.main.bundleURL)
    @ObservationIgnored private let log: (String, [String: Any]) -> Void

    init(log: @escaping (String, [String: Any]) -> Void = { _, _ in }) { self.log = log }

    var isSourceCopy: Bool { root != nil }

    /// Looks at origin/main, at most once an hour unless `force`.
    func check(force: Bool = false) {
        guard let root, !checking, !updating else { return }
        guard force || Date().timeIntervalSince(checkedAt) > 3600 else { return }
        checking = true
        Task {
            let result = await Task.detached(priority: .utility) { Self.look(at: root) }.value
            status = result
            checkedAt = Date()
            checking = false
            log("update.checked", ["status": Self.name(result)])
        }
    }

    /// Pulls and rebuilds. The build reopens ARK, so this window ends; the log is `logs/update.log`.
    func update() {
        guard let root, !updating, case .available? = status else { return }
        updating = true
        log("update.started", [:])
        let line = AppUpdate.updateCommand(root: root)
        Task.detached(priority: .utility) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = ["-lc", line] // a login shell: it finds node and pnpm
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try? process.run()
            process.waitUntilExit()
            let code = process.terminationStatus
            await MainActor.run { [self] in
                updating = false
                if code != 0 { status = .failed("The update did not finish. See logs/update.log in the ARK folder.") }
            }
        }
    }

    nonisolated private static func name(_ status: UpdateStatus) -> String {
        switch status {
        case .notASourceCopy: "not_source"
        case .upToDate: "up_to_date"
        case .available: "available"
        case .blocked: "blocked"
        case .failed: "failed"
        }
    }

    nonisolated private static func git(_ root: URL, _ arguments: [String]) -> (Int32, String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", root.path] + arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return (-1, "") }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }

    nonisolated private static func look(at root: URL) -> UpdateStatus {
        let (branchCode, branch) = git(root, ["rev-parse", "--abbrev-ref", "HEAD"])
        guard branchCode == 0 else { return .failed("This folder is not a git copy of ARK.") }
        let (_, changes) = git(root, ["status", "--porcelain", "--untracked-files=no"])
        guard git(root, ["fetch", "--quiet", "origin", AppUpdate.branch]).0 == 0 else { return .failed("Could not reach GitHub. Check the network.") }
        let (_, count) = git(root, ["rev-list", "--count", "HEAD..origin/\(AppUpdate.branch)"])
        let (_, subjects) = git(root, ["log", "--format=%s", "-n", "\(AppUpdate.maxSubjects + 3)", "HEAD..origin/\(AppUpdate.branch)"])
        return AppUpdate.status(branch: branch.trimmingCharacters(in: .whitespacesAndNewlines),
                                dirty: !changes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                                behind: Int(count.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0,
                                subjects: subjects.split(separator: "\n").map(String.init))
    }
}
