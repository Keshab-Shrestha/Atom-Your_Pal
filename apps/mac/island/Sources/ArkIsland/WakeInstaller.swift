import Foundation
import ArkIslandCore

/// Routines while ARK is closed (2026-11-04): keeps one LaunchAgent that opens ARK in the background before the next routine is due.
/// Only in ARK.app (a development build has no app to open). Off: the agent is removed. It writes one file in the user's own
/// LaunchAgents folder and runs `launchctl` for the user's own session; nothing else.
@MainActor
final class WakeInstaller {
    private var lastApplied: String?
    private let appPath = Bundle.main.bundleURL.path
    private let available = Bundle.main.bundleURL.pathExtension == "app"
    private let log: (String, [String: Any]) -> Void

    init(log: @escaping (String, [String: Any]) -> Void) { self.log = log }

    /// Call when the switch changes and when the routines change.
    func update(enabled: Bool, routineTimes: [Date]) {
        guard available else { return }
        let wake = enabled ? WakeAgent.nextWake(routineTimes: routineTimes, now: Date()) : nil
        let text = wake.map { WakeAgent.plist(appPath: appPath, at: $0) }
        let key = text ?? "off"
        guard key != lastApplied else { return }
        lastApplied = key
        let url = WakeAgent.agentURL(home: FileManager.default.homeDirectoryForCurrentUser)
        Task { [log] in
            let result = await Task.detached(priority: .utility) { () -> (String, [String: String]) in
                let domain = "gui/\(getuid())"
                _ = Self.launchctl(["bootout", "\(domain)/\(WakeAgent.label)"]) // not loaded yet is fine
                guard let text else {
                    try? FileManager.default.removeItem(at: url)
                    return ("wake.removed", [:])
                }
                do {
                    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try text.write(to: url, atomically: true, encoding: .utf8)
                    let status = Self.launchctl(["bootstrap", domain, url.path])
                    return ("wake.installed", ["ok": "\(status == 0)"])
                } catch {
                    return ("wake.failed", ["message": "\(error)"])
                }
            }.value
            log(result.0, result.1)
        }
    }

    nonisolated private static func launchctl(_ arguments: [String]) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return -1 }
        process.waitUntilExit()
        return process.terminationStatus
    }
}
