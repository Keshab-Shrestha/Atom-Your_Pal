// The setup help, error notices and the first-run tour (split out of IslandController.swift, 2026-10-16).
import AppKit
import SwiftUI
import AtomIslandCore

extension IslandController {
    // MARK: - Setup and errors (ADR-075)

    /// The runtime stopped for good (config error, repeated crashes): open the panel so its card is seen.
    func showSetupProblem() {
        model.tab = .conversation
        setExpanded(true)
    }

    func perform(_ action: FailureAction) {
        switch action {
        case .openTerminal(let command):
            openTerminal(running: command)
        case .openModelSettings:
            model.tab = .settings
            model.settingsPage = .model
            setExpanded(true)
        case .showCommand:
            break // the card shows the text itself
        case .openSettingsPane(let url):
            NSWorkspace.shared.open(url)
        case .restartRuntime:
            log("island.runtime.restart_by_user", [:])
            restartRuntime()
        case .openLog:
            openLog()
        case .switchModel(let provider, let model):
            log("model.switch_by_user", ["provider": provider, "model": model])
            self.model.chooseModel(provider: provider, model: model)
        }
    }

    /// Opens Terminal running a fixed command from the failure table, through a `.command` file, so ATOM needs no
    /// permission to script Terminal.
    func openTerminal(running command: String) {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("atom-setup.command")
        let script = "#!/bin/zsh -il\n\(command)\necho\necho 'Done. You can close this window and try ATOM again.'\n"
        do {
            try script.write(to: file, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: file.path)
        } catch {
            log("setup.terminal_failed", ["message": "\(error)"])
            return
        }
        guard let terminal = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") else {
            log("setup.terminal_failed", ["message": "Terminal not found"])
            return
        }
        NSWorkspace.shared.open([file], withApplicationAt: terminal, configuration: NSWorkspace.OpenConfiguration())
    }

    /// The log in Console; if Console cannot open it, the file (or its folder) in Finder.
    func openLog() {
        guard let url = logURL else { return }
        guard FileManager.default.fileExists(atPath: url.path) else {
            NSWorkspace.shared.activateFileViewerSelecting([url.deletingLastPathComponent()])
            return
        }
        let console = URL(fileURLWithPath: "/System/Applications/Utilities/Console.app")
        NSWorkspace.shared.open([url], withApplicationAt: console, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            guard error != nil else { return }
            DispatchQueue.main.async { NSWorkspace.shared.activateFileViewerSelecting([url]) }
        }
    }

    /// Never asked: the click asks macOS (Microphone, Input Monitoring). Otherwise: the row's pane.
    func permissionButton(_ row: PermissionRow) {
        let state = model.permissions.states[row]
        log("setup.permission_button", ["row": row.title, "state": state.map { "\($0)" } ?? "unknown"])
        if PermissionRowView.asksOnClick(row, state) {
            switch row {
            case .microphone:
                Task { [weak self] in
                    _ = await DictationCapture.requestPermission()
                    self?.model.permissions.refresh()
                }
                return
            case .inputMonitoring:
                shortcuts.requestKeyAccess()
                model.permissions.refresh()
                return
            default:
                break
            }
        }
        NSWorkspace.shared.open(row.settingsURL)
    }

    // MARK: - First-run tour (ADR-075)

    func maybeStartTour() {
        guard !tour.isRunning, !model.settings.tourDone else { return }
        guard !talking, !dictating, !model.status.isBusy else { return skipTour() } // the user talked first
        guard FirstRunTour.shouldStart(palShown: pet.isShown, tourDone: model.settings.tourDone, runtimeReady: runtimeReady) else { return }
        log("tour.start", [:])
        runTourStep(tour.start())
    }

    func replayTour() {
        guard pet.isShown, !tour.isRunning else { return }
        pet.poke()
        log("tour.replay", [:])
        schedule([(0.4, { [self] in if !tour.isRunning, pet.isShown { runTourStep(tour.start()) } })])
    }

    func runTourStep(_ step: TourStep) {
        switch step {
        case .hello:
            pet.react(.hello)
        case .say(let title, let detail):
            model.status.say(title, detail)
            statusChanged()
        case .point(let label):
            model.status.acknowledge() // the greeting is over; the label beside Pal takes over
            pointAtMenuIcon(label)
        case .back:
            if model.pointing.target != nil { finishPointing() }
        case .done:
            endTour(outcome: "done")
            return
        }
        guard let index = tour.index, index + 1 < FirstRunTour.script.count else { return }
        let timer = Timer(timeInterval: FirstRunTour.script[index + 1].after, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let next = self.tour.advance() else { return }
                self.runTourStep(next)
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        tourTimer = timer
    }

    /// Pal flies to ATOM's menu-bar icon, the same way it points for the model (ADR-054).
    func pointAtMenuIcon(_ label: String) {
        guard let anchor = menuIcon.anchor, let primary = NSScreen.screens.first else {
            trace("tour: menu-bar icon not on screen")
            return
        }
        let screen = anchor.screen.frame
        let barHeight = max(1, screen.maxY - Self.menuBarBottom(of: anchor.screen))
        // Pointing takes the driver's coordinates: points from the top-left of the main display, y down.
        let target = PointTarget(x: Double(anchor.midX - 11 - primary.frame.minX), y: Double(primary.frame.maxY - screen.maxY),
                                 w: 22, h: Double(barHeight), label: label)
        model.pointing.apply(.computerPoint(target))
        startPointing(target)
        refresh()
    }

    /// The user talked or dictated before or during the tour: it ends, and is not offered again.
    func skipTour() {
        guard tour.isRunning || !model.settings.tourDone else { return }
        let wasRunning = tour.userTalked()
        if wasRunning, model.pointing.target != nil { finishPointing() }
        endTour(outcome: "skipped")
    }

    func endTour(outcome: String) {
        tourTimer?.invalidate()
        tourTimer = nil
        _ = tour.userTalked() // not running any more
        if !model.settings.tourDone { model.settings.tourDone = true }
        log("tour.end", ["outcome": outcome])
    }
}
