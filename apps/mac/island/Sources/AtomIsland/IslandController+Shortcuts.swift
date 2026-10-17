// The global shortcuts: what each key press does (split out of IslandController.swift, 2026-10-16).
import AppKit
import SwiftUI
import AtomIslandCore

extension IslandController {
    // MARK: - Shortcuts

    func shortcut(_ trigger: ShortcutTrigger) {
        trace("shortcut \(trigger)")
        // Asleep or locked: Talk does not open any microphone, the app's or the runtime's (dictation checks for itself).
        switch trigger {
        case .holdBegan(.talk) where sleep.paused:
            talkHeldWhilePaused = true
            return
        case .holdEnded(.talk), .holdCancelled(.talk):
            if talkHeldWhilePaused { talkHeldWhilePaused = false; return }
        default:
            break
        }
        pet.poke()
        switch trigger {
        case .holdBegan(.talk):
            skipTour()
            if dictation.isActive {
                // A dictation is listening or working: Talk would open a second microphone through the runtime, and the dictated speech could be
                // taken as a question (code check, 2026-10-16). Finish or cancel the dictation first.
                trace("talk ignored: a dictation is in progress")
                return
            }
            dictation.followUpCancelled() // the keys take over from listening for an answer
            model.typedTurn = false
            talking = true
            let interrupting = model.status.isBusy
            if talkLocally, dictation.talkBegan() {
                talkingLocally = true
                if interrupting { model.send(.talkCancel) } // stop ATOM speaking: the microphone is open
            } else {
                talkingLocally = false
                model.send(.talkStart)
            }
        case .holdEnded(.talk):
            guard talking else { return } // cancelled meanwhile (a lock or a sleep): the key-up that follows sends nothing
            talking = false
            if talkingLocally { dictation.talkEnded() } else { model.send(.talkSend) }
        case .holdCancelled(.talk):
            // Like holdEnded: a Talk that never began (a dictation was active) or was cancelled already has nothing to cancel. Without this guard a spoiled
            // hold sent a cancel that stopped an unrelated ATOM turn.
            guard talking else { return }
            talking = false
            if talkingLocally { dictation.talkCancelled() } else { model.send(.talkCancel) }
        case .pressed(.toggleIsland):
            toggleWindow()
        case .pressed(.quickAction):
            quickActions.begin()
        case .pressed(.cancel):
            talking = false
            if dictation.isActive { dictation.cancel() } else { stopWork() }
        case .holdBegan(.dictate):
            skipTour()
            dictation.followUpCancelled()
            model.meter.reset()
            dictation.holdBegan()
        case .holdEnded(.dictate):
            dictation.holdEnded()
        case .holdCancelled(.dictate):
            dictation.holdCancelled()
        default:
            break
        }
        refresh()
    }

    /// Esc or the strip's Stop: ends the turn, declines anything waiting, and the strip says "Stopped".
    func stopWork() {
        talking = false
        dictation.talkCancelled()
        model.send(.talkCancel)
        if model.work.isShown(at: Self.now), model.work.outcome == .working { model.work.stopped(now: Self.now) }
        trace("stop")
        refresh()
    }

    func linger(_ seconds: Double) {
        statusUntil = max(statusUntil, Self.now + seconds)
    }

    static var now: Double { ProcessInfo.processInfo.systemUptime }
}
