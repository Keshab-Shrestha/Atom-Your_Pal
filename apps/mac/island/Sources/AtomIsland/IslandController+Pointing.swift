// Pointing, Talk through Parakeet and Dictation (split out of IslandController.swift, 2026-10-16).
import AppKit
import SwiftUI
import AtomIslandCore

extension IslandController {
    // MARK: - Pointing (ADR-054, ADR-056)

    /// How long Pal stays at the place once it gets there, so the user has time to look.
    static let pointDwell: Double = 7

    /// The model named a place: Pal flies there. Its label shows on arrival, beside it.
    func startPointing(_ target: PointTarget) {
        guard pet.isShown else { // no Pal: nothing to fly. The strip says what it is.
            trace("point without Pal: \(target.label)")
            return
        }
        let areas = NSScreen.screens.map { ScreenArea(frame: $0.frame, visible: $0.visibleFrame) }
        let scale = model.settings.palSize.scale
        // No bubble goes with Pal now (ADR-056): it only needs room for itself.
        guard let flight = PointPlacement.flight(to: target, screens: areas, palHeight: 54 * scale, palHalfWidth: 22 * scale,
                                                 bubbleHeight: 0) else {
            trace("point off every display, not flown to")
            model.pointing.clear()
            return
        }
        pointTimer?.invalidate()
        pointTimer = nil
        pointArrived = false
        pointLabel.hide()
        pet.point(at: flight.feet)
        trace("point \(target.label) feet=\(Int(flight.feet.x)),\(Int(flight.feet.y))")
    }

    /// Pal got there: the label shows and the dwell starts.
    func arrivedAtPoint() {
        pointArrived = true
        pointTimer?.invalidate()
        let timer = Timer(timeInterval: Self.pointDwell, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.finishPointing() }
        }
        RunLoop.main.add(timer, forMode: .common)
        pointTimer = timer
        refresh()
    }

    func finishPointing() {
        pointTimer?.invalidate()
        pointTimer = nil
        model.pointing.clear()
        statusChanged()
    }

    /// Keeps Pal and its label in step with the pointing state: it ended (a new turn, a reset, the dwell) → go back.
    func updatePointing() {
        if let target = model.pointing.target, pet.isShown, pointArrived {
            let scale = model.settings.palSize.scale
            pointLabel.show(PointingState.line(for: target), palette: model.settings.theme.palette, feet: pet.feetPoint, palHeight: 54 * scale, palHalfWidth: 22 * scale)
            if !pointLabel.isVisible { trace("point label show") }
            return
        }
        if pointLabel.isVisible { pointLabel.hide() }
        guard model.pointing.target == nil, pet.isPointing else { return }
        pointTimer?.invalidate()
        pointTimer = nil
        pointArrived = false
        pet.endPointing()
    }

    // MARK: - Talk through Parakeet (ADR-063)

    /// Shown exactly like the runtime's own states, so the island looks the same whichever path heard the words.
    func talkPhase(_ phase: DictationController.TalkPhase) {
        switch phase {
        case .listening:
            localListening = false
            apply(.state(.listening))
            apply(.micReady) // ADR-093: this microphone is already capturing (talkBegan started it): "Speak now"
            localListening = true
        case .heard(let text):
            localListening = false
            model.ask(text, spoken: true) // the runtime answers with transcript, thinking, reply, speaking
        case .nothing:
            localListening = false
            apply(.notice(kind: "no_speech", message: "Didn't catch that. Hold the keys while you speak, then let go."))
            apply(.state(.idle))
        case .failed(let message):
            localListening = false
            apply(.notice(kind: "no_speech", message: "Couldn't transcribe: \(message)"))
            apply(.state(.idle))
        case .cancelled:
            localListening = false
            apply(.state(.idle))
        }
    }

    // MARK: - Dictation

    /// Shows a dictation's progress, and keeps the status out while one is in progress.
    func dictationPhase(_ phase: DictationPhase) {
        model.status.apply(phase)
        switch phase {
        case .loading, .listening, .listeningHandsFree, .transcribing:
            if !dictating { model.work.dismiss() } // a new request: the last Mac work is out of the way
            dictating = true
        case .done(let outcome):
            dictating = false
            linger(model.status.needsAttention ? afterProblem : (outcome == .busy ? afterProblem : afterTurn))
        case .cancelled:
            dictating = false
        }
        statusChanged()
    }

    /// Where the user's spelling fixes live: `vocabulary.txt` in ATOM's folder under Application Support.
    static var vocabularyURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/ATOM/vocabulary.txt")
    }

    func playTone(_ sound: DictationController.Sound) {
        guard model.settings.soundsEnabled else { return }
        NSSound(named: sound == .start ? "Tink" : "Pop")?.play()
    }
}
