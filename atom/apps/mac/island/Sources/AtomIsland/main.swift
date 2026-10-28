// ATOM Island: a background app (no Dock icon, no main window) that runs the ATOM runtime.
// It starts, supervises and stops the runtime, shows the island and listens for ATOM's shortcuts.
import AppKit
import AtomIslandCore

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
    private var island: IslandController?
    private var log = IslandLog(url: AppDelegate.fallbackLogURL)
    private var signalSources: [DispatchSourceSignal] = []
    /// Prints event names and status changes to stderr when ATOM_ISLAND_TRACE=1 (development only).
    private let trace = AtomEnv.read("ATOM_ISLAND_TRACE") == "1"

    /// Used only until the project folder is known (e.g. when it cannot be found).
    static let fallbackLogURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/ATOM/island.log")

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let gallery = AtomEnv.read("ATOM_ISLAND_GALLERY") {
            IslandGallery.render(to: URL(fileURLWithPath: gallery))
            NSApp.terminate(nil)
            return
        }
        handleTerminationSignals()
        if anotherInstanceIsRunning() {
            log.info("island.already_running")
            NSApp.terminate(nil)
            return
        }

        var launch: RuntimeLaunch
        do {
            launch = try RuntimeLocator.live().locate()
        } catch {
            log.error("island.locate_failed", ["message": "\(error)"])
            log.flush()
            showProblem(title: "ATOM cannot start", message: "\(error)")
            NSApp.terminate(nil)
            return
        }

        // ADR-054: the user's choice from Settings → Computer wins over ATOM_COMPUTER in .env; with no choice, .env decides.
        if let choice = UserDefaults.standard.object(forKey: IslandSettings.computerOverrideKey) as? Bool {
            launch.environment["ATOM_COMPUTER"] = choice ? "1" : "0"
        }

        log = IslandLog(url: launch.directory.appendingPathComponent("logs/atom.log"))
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
        log.info("island.start", ["version": version, "pid": Int(ProcessInfo.processInfo.processIdentifier)])

        let trace = self.trace
        let settings = IslandSettings()
        for action in settings.unreadableShortcuts {
            log.warn("settings.shortcut_unreadable", ["action": action.rawValue])
        }
        let log = self.log
        let island = IslandController(settings: settings, log: { event, fields in log.info(event, fields) }, trace: { message in
            if trace { FileHandle.standardError.write(Data("\(message)\n".utf8)) }
        })
        self.island = island
        island.start()

        supervisor = RuntimeSupervisor(
            launch: launch,
            queue: DispatchQueue(label: "dev.atom.island.runtime"),
            log: log,
            onEvent: { [weak self] event in
                if trace, event.name != "mic.level" { FileHandle.standardError.write(Data("event \(event.name)\n".utf8)) }
                onMain { self?.island?.apply(event) }
            },
            onStatus: { [weak self] status in
                onMain { self?.statusChanged(status) }
            })
        island.model.transport = { [weak self] command in self?.supervisor?.send(command) }
        supervisor?.onCommandDropped = { command in onMain { [weak island] in island?.commandDropped(command) } }
        island.model.applyComputer = { [weak self] on in self?.supervisor?.restart(environment: ["ATOM_COMPUTER": on ? "1" : "0"]) }
        // ADR-075: "Restart ATOM" starts it again with a fresh restart policy; "Open log" opens this file.
        island.restartRuntime = { [weak self] in self?.supervisor?.start() }
        island.logURL = launch.directory.appendingPathComponent("logs/atom.log")
        supervisor?.start()
    }

    private var terminating = false

    // Launch Services sends a reopen when the user opens the already-running menu-bar app.
    // Reveal a hidden window, but keep an already-visible editor or Quick actions panel in place.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard !terminating else { return false }
        // The companion is itself a visible window, so Launch Services' flag cannot tell whether chat is open.
        island?.helpersWindow.show()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // A second request (SIGTERM, then Command-Q) must not stop the runtime and reply a second time.
        if terminating { return .terminateLater }
        terminating = true
        UserDefaults.standard.set(island?.helpersWindow.isVisible == true, forKey: "atom.window.restoreOnLaunch")
        SecretClipboard.clearIfStillSecret() // a copied API token does not outlive the app
        island?.stop()
        guard let supervisor else {
            log.flush()
            return .terminateNow
        }
        // Let the runtime release the microphone and stop speaking before the app goes away.
        let log = self.log
        supervisor.stop(forQuit: true) {
            log.info("island.quit")
            log.flush()
            onMain { NSApp.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }

    private func statusChanged(_ status: RuntimeSupervisor.Status) {
        if trace { FileHandle.standardError.write(Data("status \(status)\n".utf8)) }
        island?.apply(status)
        switch status {
        case .configError, .failed:
            // ADR-075: the panel's card explains it in one sentence and offers "Restart ATOM" and "Open log".
            island?.showSetupProblem()
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

LegacyMigration.run() // ADR-105: settings and folders from the ATOM name, before anything reads them
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // background app: no Dock icon, no menu bar
app.run()
