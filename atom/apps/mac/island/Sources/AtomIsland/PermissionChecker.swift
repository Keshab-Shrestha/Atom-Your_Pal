import AppKit
import ApplicationServices
import AVFoundation
import EventKit
import IOKit.hid
import Observation
import AtomIslandCore

/// Reads every permission of the checklist from macOS (ADR-075). Every read is a status query that never prompts:
/// a prompt comes only from real use or from the user clicking "Allow…".
@MainActor @Observable
final class PermissionChecker {
    /// Nil until the first read.
    var states: [PermissionRow: PermissionState] = [:]
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var automationCheck: Task<Void, Never>?

    /// How often the checklist is re-read while Settings → Privacy is open.
    static let pollInterval = 1.5

    /// The first-launch card stays until these are granted. False until the first read, so it does not flash.
    var essentialGranted: Bool {
        states.isEmpty || PermissionRow.essential.allSatisfy { states[$0] == .granted }
    }

    /// Rows to show: apps that are not installed are left out.
    var visibleRows: [PermissionRow] {
        PermissionRow.all.filter { states[$0] != .notApplicable }
    }

    func refresh() {
        var next = states
        next[.microphone] = .authorization(AVCaptureDevice.authorizationStatus(for: .audio).rawValue)
        next[.inputMonitoring] = .listenAccess(Int(IOHIDCheckAccess(kIOHIDRequestTypeListenEvent).rawValue))
        next[.accessibility] = .trusted(AXIsProcessTrusted()) // never the prompting AXIsProcessTrustedWithOptions
        next[.calendar] = .authorization(EKEventStore.authorizationStatus(for: .event).rawValue)
        next[.reminders] = .authorization(EKEventStore.authorizationStatus(for: .reminder).rawValue)
        if next != states { states = next }
        refreshAutomation()
    }

    /// Re-reads every 1.5 s while Settings → General is visible.
    func startPolling() {
        refresh()
        guard timer == nil else { return }
        let timer = Timer(timeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    /// Apple-event permission is an IPC round trip per app, so it is asked off the main thread.
    private func refreshAutomation() {
        guard automationCheck == nil else { return } // the last check is still running
        let installed = AutomationTarget.allCases.filter { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0.bundleId) != nil }
        automationCheck = Task { [weak self] in
            let answers = await Task.detached { () -> [AutomationTarget: PermissionState] in
                var answers: [AutomationTarget: PermissionState] = [:]
                for app in AutomationTarget.allCases {
                    let isInstalled = installed.contains(app)
                    answers[app] = .automation(isInstalled ? Self.automationStatus(app.bundleId) : 0, installed: isInstalled)
                }
                return answers
            }.value
            guard let self else { return }
            var next = self.states
            for (app, state) in answers { next[.automation(app)] = state }
            if next != self.states { self.states = next }
            self.automationCheck = nil
        }
    }

    /// `askUserIfNeeded: false`: answers from the stored decision only, never shows the consent prompt.
    private nonisolated static func automationStatus(_ bundleId: String) -> Int32 {
        let target = NSAppleEventDescriptor(bundleIdentifier: bundleId)
        guard let desc = target.aeDesc else { return -600 }
        return AEDeterminePermissionToAutomateTarget(desc, AEEventClass(typeWildCard), AEEventID(typeWildCard), false)
    }
}
