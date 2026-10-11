import Foundation
import Testing
@testable import ZenoIslandCore

@Suite("Answering without keys (ADR-067)")
struct FollowUpTests {
    /// Feeds loudness every 0.1 s; returns the first decision that is not `.listen`, and when.
    private func run(_ e: inout SpeechEndpoint, _ levels: [Float]) -> (SpeechEndpoint.Decision, Double) {
        for (i, level) in levels.enumerated() {
            let t = Double(i + 1) * 0.1
            let d = e.update(elapsed: t, rms: level)
            if d != .listen { return (d, t) }
        }
        return (.listen, Double(levels.count) * 0.1)
    }

    @Test func givesUpWhenNobodySpeaks() {
        var e = SpeechEndpoint()
        let (d, t) = run(&e, Array(repeating: 0.002, count: 80))
        #expect(d == .giveUp)
        #expect(abs(t - 6) < 0.01)
    }

    @Test func aClickIsNotSpeech() {
        var e = SpeechEndpoint()
        let (d, _) = run(&e, [0.002, 0.2] + Array(repeating: 0.002, count: 70))
        #expect(d == .giveUp)
    }

    @Test func finishesAfterSpeechThenQuiet() {
        var e = SpeechEndpoint()
        let speech: [Float] = Array(repeating: 0.05, count: 12) + [0.004, 0.05, 0.05] // a short pause does not end it
        let (d, t) = run(&e, Array(repeating: 0.002, count: 5) + speech + Array(repeating: 0.002, count: 20))
        #expect(d == .finish)
        #expect(t > 2.9 && t < 3.15) // quiet from 2.1 s, plus 0.9 s (one tick of float slack)
    }

    @Test func longAnswerIsCut() {
        var e = SpeechEndpoint(maxSeconds: 3)
        let (d, t) = run(&e, Array(repeating: 0.05, count: 60))
        #expect(d == .finish)
        #expect(t <= 3.3)
    }

    @Test func onlyQuestionsInvite() {
        #expect(SpeechEndpoint.invitesAnswer("Want me to set one?"))
        #expect(SpeechEndpoint.invitesAnswer("Which city? "))
        #expect(!SpeechEndpoint.invitesAnswer("It is sunny."))
        #expect(!SpeechEndpoint.invitesAnswer(""))
    }
}
