import Foundation

/// ADR-067: after ZENO asks a question, the microphone opens for a moment so the user can just answer.
/// This decides, from the loudness of the last stretch of audio, when they started and stopped speaking.
public struct SpeechEndpoint: Equatable, Sendable {
    public enum Decision: Equatable, Sendable {
        /// Keep listening.
        case listen
        /// They spoke and have stopped: transcribe.
        case finish
        /// Nobody spoke in time (or only noise): close the microphone quietly.
        case giveUp
    }

    /// How long to wait for the first word.
    public var waitSeconds: Double
    /// Silence after speech that ends the answer.
    public var endSilenceSeconds: Double
    /// Longest answer.
    public var maxSeconds: Double
    /// Loudness (RMS) that counts as speech, and how long it must last to count as the start.
    public var speechRMS: Float
    public var startSeconds: Double

    public private(set) var speechStartedAt: Double?
    private var loudSince: Double?
    private var quietSince: Double?

    public init(waitSeconds: Double = 6, endSilenceSeconds: Double = 0.9, maxSeconds: Double = 20,
                speechRMS: Float = 0.012, startSeconds: Double = 0.15) {
        self.waitSeconds = waitSeconds
        self.endSilenceSeconds = endSilenceSeconds
        self.maxSeconds = maxSeconds
        self.speechRMS = speechRMS
        self.startSeconds = startSeconds
    }

    public var heardSpeech: Bool { speechStartedAt != nil }

    /// `elapsed`: seconds since the microphone opened; `rms`: loudness of the audio since the last update.
    public mutating func update(elapsed: Double, rms: Float) -> Decision {
        let loud = rms >= speechRMS
        if speechStartedAt == nil {
            if loud {
                if loudSince == nil { loudSince = elapsed }
                if elapsed - loudSince! >= startSeconds { speechStartedAt = loudSince }
            } else {
                loudSince = nil
            }
            if speechStartedAt == nil { return elapsed >= waitSeconds ? .giveUp : .listen }
        }
        if elapsed - speechStartedAt! >= maxSeconds { return .finish }
        if loud || rms >= speechRMS * 0.6 {
            quietSince = nil
        } else {
            if quietSince == nil { quietSince = elapsed }
            if elapsed - quietSince! >= endSilenceSeconds { return .finish }
        }
        return .listen
    }

    public static func rms(_ samples: ArraySlice<Float>) -> Float {
        guard !samples.isEmpty else { return 0 }
        var sum: Float = 0
        for s in samples { sum += s * s }
        return (sum / Float(samples.count)).squareRoot()
    }

    /// Does this reply invite an answer? A question at the end of what was said.
    public static func invitesAnswer(_ reply: String) -> Bool {
        let trimmed = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.hasSuffix("?") || trimmed.hasSuffix("?\"") || trimmed.hasSuffix("?)")
    }
}
