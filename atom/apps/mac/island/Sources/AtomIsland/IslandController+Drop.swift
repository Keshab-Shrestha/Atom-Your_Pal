// Follow-up listening and dropping Pal on a window (split out of IslandController.swift, 2026-10-16).
import AppKit
import SwiftUI
import AtomIslandCore

extension IslandController {
    // MARK: - Follow-up (ADR-067)


    /// ATOM's reply ended in a question: open the microphone for the answer, once its voice has stopped.
    func maybeFollowUp() {
        let reply = lastReply
        lastReply = ""
        let typed = model.typedTurn
        model.typedTurn = false
        guard !typed, model.settings.followUpEnabled, talkLocally, SpeechEndpoint.invitesAnswer(reply) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, !self.talking, !self.dictating, !self.model.status.isBusy else { return }
            if self.dictation.followUpBegan() {
                self.talkingLocally = true
                self.trace("follow-up listening")
            }
        }
    }

    // MARK: - Drop Pal on a window (ADR-074)

    /// Pal was dropped with Option on this app's window: bring the app to the front, then ask the runtime to read it.
    func pointedAt(_ app: NSRunningApplication) {
        let name = app.localizedName ?? "this app"
        guard let bundleId = app.bundleIdentifier else {
            log("pal.pointed.refused", ["reason": "no_bundle_id"])
            refusePoint(name, "ATOM doesn't read \(name).")
            return
        }
        guard runtimeReady else {
            log("pal.pointed.refused", ["bundleId": bundleId, "reason": "not_connected"])
            refusePoint(name, "ATOM isn't running.")
            return
        }
        log("pal.pointed", ["bundleId": bundleId])
        trace("pal pointed")
        pointedBundleId = bundleId
        Task { [weak self] in
            await Self.bringToFront(app)
            self?.model.send(.contextWindow(bundleId: bundleId, name: name))
        }
    }

    /// Shown like the runtime's own refusal: a bubble, no microphone.
    func refusePoint(_ app: String, _ message: String) {
        apply(.contextReady(app: app, ok: false, message: message))
    }

    /// The runtime read the app (or refused it). The user pointed on purpose, so the microphone opens whatever the
    /// follow-up setting says; the bubble then names the app (`IslandStatus`).
    func contextReady(ok: Bool) {
        let bundleId = pointedBundleId
        pointedBundleId = nil
        guard ok else {
            if let bundleId { log("pal.pointed.refused", ["bundleId": bundleId]) }
            return
        }
        guard talkLocally, !talking, !dictating, !model.status.isBusy, dictation.followUpBegan() else { return }
        talkingLocally = true
        trace("pointed: listening")
    }

    /// Activates the app and waits until it is in front (at most half a second), so the runtime reads that app.
    static func bringToFront(_ app: NSRunningApplication) async {
        guard !app.isTerminated, NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier else { return }
        app.activate()
        let deadline = ProcessInfo.processInfo.systemUptime + 0.5
        while NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier,
              ProcessInfo.processInfo.systemUptime < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    func statusChanged() {
        pet.update(model.status.kind, micLive: model.status.micLive)
        if model.status.title != lastTitle {
            lastTitle = model.status.title
            trace("status \(model.status.title) — \(model.status.detail)")
            snapshotSoon()
        }
        if model.status.needsAttention { linger(afterProblem) }
        refresh()
    }
}
