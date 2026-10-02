// ZENO Island: a background app (no Dock icon, no main window) that runs the ZENO runtime.
// Task 0.5.3 is the skeleton: it starts, supervises and stops the runtime. The panel arrives in 0.5.4.
import AppKit
import ZenoIslandCore

/// Runs `work` on the main thread through the run loop (all common modes), not the main dispatch queue.
/// Quitting waits for the runtime inside a nested run loop; if that wait started from a main-queue block,
/// further main-queue blocks could not run until it ended and the app would hang. Run-loop blocks still run.
func onMain(_ work: @escaping @MainActor () -> Void) {
    let loop = CFRunLoopGetMain()
    CFRunLoopPerformBlock(loop, CFRunLoopMode.commonModes.rawValue) { MainActor.assumeIsolated { work() } }
    CFRunLoopWakeUp(loop)
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var supervisor: RuntimeSupervisor?
    private var log = IslandLog(url: AppDelegate.fallbackLogURL)
    private var signalSources: [DispatchSourceSignal] = []
    /// Prints event names and status changes to stderr when ZENO_ISLAND_TRACE=1 (development only).
    private let trace = ProcessInfo.processInfo.environment["ZENO_ISLAND_TRACE"] == "1"

    /// Used only until the project folder is known (e.g. when it cannot be found).
    static let fallbackLogURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/ZENO/island.log")

    func applicationDidFinishLaunching(_ notification: Notification) {
        handleTerminationSignals()
        if anotherInstanceIsRunning() {
            log.info("island.already_running")
            NSApp.terminate(nil)
            return
        }

        let launch: RuntimeLaunch
        do {
            launch = try RuntimeLocator.live().locate()
        } catch {
            log.error("island.locate_failed", ["message": "\(error)"])
            log.flush()
            showProblem(title: "ZENO cannot start", message: "\(error)")
            NSApp.terminate(nil)
            return
        }

        log = IslandLog(url: launch.directory.appendingPathComponent("logs/zeno.log"))
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
        log.info("island.start", ["version": version, "pid": Int(ProcessInfo.processInfo.processIdentifier)])

        let trace = self.trace
        supervisor = RuntimeSupervisor(
            launch: launch,
            queue: DispatchQueue(label: "dev.zeno.island.runtime"),
            log: log,
            onEvent: { event in
                if trace, event.name != "mic.level" { FileHandle.standardError.write(Data("event \(event.name)\n".utf8)) }
            },
            onStatus: { [weak self] status in
                onMain { self?.statusChanged(status) }
            })
        supervisor?.start()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let supervisor else {
            log.flush()
            return .terminateNow
        }
        // Let the runtime release the microphone and stop speaking before the app goes away.
        let log = self.log
        supervisor.stop {
            log.info("island.quit")
            log.flush()
            onMain { NSApp.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }

    private func statusChanged(_ status: RuntimeSupervisor.Status) {
        if trace { FileHandle.standardError.write(Data("status \(status)\n".utf8)) }
        switch status {
        case .configError(let message):
            // Until the panel exists (Task 0.5.4) an alert is the only way to explain this.
            showProblem(title: "ZENO's settings need attention", message: message + "\n\nFix .env in the ZENO folder, then open ZENO again.")
            NSApp.terminate(nil)
        case .failed(let message):
            showProblem(title: "ZENO stopped", message: message + "\n\nDetails are in logs/zeno.log.")
            NSApp.terminate(nil)
        default:
            break
        }
    }

    private func showProblem(title: String, message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = message
        alert.runModal()
    }

    private func anotherInstanceIsRunning() -> Bool {
        guard let id = Bundle.main.bundleIdentifier else { return false } // not bundled (swift run)
        let me = ProcessInfo.processInfo.processIdentifier
        return NSRunningApplication.runningApplications(withBundleIdentifier: id).contains { $0.processIdentifier != me }
    }

    /// SIGTERM / SIGINT (e.g. `kill`, Ctrl+C) quit through the normal path, so the runtime is stopped too.
    private func handleTerminationSignals() {
        for sig in [SIGTERM, SIGINT] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .global())
            source.setEventHandler { onMain { NSApp.terminate(nil) } }
            source.resume()
            signalSources.append(source)
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // background app: no Dock icon, no menu bar
app.run()
