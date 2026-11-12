import Foundation

/// The microphone. The real one is `DictationCapture`; the tests use a fake.
public protocol MicSource: AnyObject, Sendable {
    func start() throws
    /// Stops and returns 16 kHz mono samples.
    func stop() -> [Float]
    var onLevel: (@Sendable (Float) -> Void)? { get set }
}

/// The speech model. The real one is Parakeet (FluidAudio); the tests use a fake.
public protocol Transcriber: Sendable {
    func transcribe(_ samples: [Float]) async throws -> String
}

/// Audio rules, the same as `DictationAudio` in the Swift app.
public enum Audio {
    public static let minimumSamples = 16_000
    static let windowSamples = 480
    static let speechRMS: Float = 0.006
    static let speechWindowsNeeded = 4

    /// Parakeet needs about a second of audio, so a short clip gets silence at the end.
    public static func padded(_ samples: [Float]) -> [Float] {
        samples.count >= minimumSamples ? samples : samples + [Float](repeating: 0, count: minimumSamples - samples.count)
    }

    /// False for a muted microphone or a tap: the model invents words from silence.
    public static func hasSpeech(_ samples: [Float]) -> Bool {
        var loud = 0
        var start = 0
        while start + windowSamples <= samples.count {
            var sum: Float = 0
            for i in start..<(start + windowSamples) { sum += samples[i] * samples[i] }
            if (sum / Float(windowSamples)).squareRoot() >= speechRMS {
                loud += 1
                if loud >= speechWindowsNeeded { return true }
            }
            start += windowSamples
        }
        return false
    }
}

/// Runs the commands and returns the events to write. It holds no I/O, so a test drives it with fakes.
public final class Session: @unchecked Sendable {
    private let audio: MicSource
    private let model: Transcriber
    private var recording = false
    private let emit: @Sendable (Event) -> Void

    public init(audio: MicSource, model: Transcriber, emit: @escaping @Sendable (Event) -> Void) {
        self.audio = audio
        self.model = model
        self.emit = emit
        audio.onLevel = { peak in emit(.level(Double(peak))) }
    }

    public func handle(_ command: Command) async {
        switch command {
        case .start:
            guard !recording else { return }
            do {
                try audio.start()
                recording = true
            } catch {
                emit(.error("\(error)"))
            }
        case .cancel:
            if recording { _ = audio.stop() }
            recording = false
        case .stop:
            guard recording else { return emit(.error("The microphone was not on.")) }
            recording = false
            let samples = audio.stop()
            guard Audio.hasSpeech(samples) else { return emit(.transcript("")) }
            do {
                let text = try await model.transcribe(Audio.padded(samples))
                emit(.transcript(text.trimmingCharacters(in: .whitespacesAndNewlines)))
            } catch {
                emit(.error("\(error)"))
            }
        }
    }
}
