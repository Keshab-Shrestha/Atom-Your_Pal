import AppKit
import ZenoIslandCore

/// Runs one dictation from the shortcut to the typed text (ADR-047):
/// hold → capture → let go → transcribe → type into the app that was in front.
///
/// It owns the microphone while dictating and never talks to the runtime, so dictation works with no model key,
/// no network and while the conversation feature is off. Everything it shows goes through `onPhase`.
@MainActor
final class DictationController {
    /// What the island should show.
    var onPhase: (DictationPhase) -> Void = { _ in }
    /// Mic peaks 0–1 while listening, for the level meter.
    var onLevel: (Float) -> Void = { _ in }
    /// For the log: event name and fields.
    var log: (String, [String: Any]) -> Void = { _, _ in }
    /// Start and stop tones, if the user wants them.
    var playSound: (Sound) -> Void = { _ in }
    /// ZENO is in the middle of a conversation turn: dictation must not take the microphone.
    var conversationBusy: () -> Bool = { false }

    enum Sound { case start, stop }

    private let capture = DictationCapture()
    private let model = DictationModel()
    private let inserter = TextInserter()
    private let vocabularyURL: URL

    private enum State { case idle, listening(since: Double, target: TextInserter.Target), working }
    private var state = State.idle
    private var modelLoading: Task<Void, Never>?
    private var modelError: String?
    private var work: Task<Void, Never>?

    /// Shortest recording that counts as speech rather than a slip of the fingers.
    private let tooShort = DictationAudio.tooShortSeconds

    init(vocabularyURL: URL) {
        self.vocabularyURL = vocabularyURL
        capture.onLevel = { [weak self] peak in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.onLevel(peak) } }
        }
        capture.onEvent = { [weak self] message in
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.log("dictation.capture", ["detail": message]) } }
        }
    }

    var isActive: Bool {
        if case .idle = state { return false }
        return true
    }

    // MARK: - Starting up

    /// Prepares the microphone and loads the speech model in the background, so the first dictation is instant.
    func warmUp() {
        if let problem = capture.prepare() { log("dictation.prepare_failed", ["detail": "\(problem)"]) }
        loadVocabulary()
        guard modelLoading == nil else { return }
        let downloaded = DictationModel.isDownloaded
        log("dictation.model_loading", ["downloaded": downloaded])
        modelLoading = Task { [model] in
            let started = ProcessInfo.processInfo.systemUptime
            do {
                try await model.load()
                let seconds = ProcessInfo.processInfo.systemUptime - started
                await MainActor.run { self.modelError = nil; self.log("dictation.model_ready", ["seconds": (seconds * 10).rounded() / 10]) }
            } catch {
                await MainActor.run { self.modelError = "\(error)"; self.log("dictation.model_failed", ["message": "\(error)"]) }
            }
        }
    }

    /// Test hook (`ZENO_DICTATION_FILE=a.wav,b.wav`): runs recordings through the same recognition path as a real
    /// dictation, without the microphone or typing, and logs `dictation.selftest` for each.
    func selfTest(files: [String]) {
        Task { [weak self] in
            guard let self else { return }
            await self.modelLoading?.value
            for path in files {
                guard let samples = Self.readWAV(path) else { self.log("dictation.selftest", ["file": path, "error": "unreadable"]); continue }
                let started = ProcessInfo.processInfo.systemUptime
                do {
                    let text = await self.model.polish(SpokenPunctuation.apply(to: try await self.model.transcribe(samples)))
                    self.log("dictation.selftest", ["file": (path as NSString).lastPathComponent,
                                                    "ms": Int((ProcessInfo.processInfo.systemUptime - started) * 1000), "text": text])
                } catch {
                    self.log("dictation.selftest", ["file": path, "error": "\(error)"])
                }
            }
        }
    }

    /// 16 kHz mono 16-bit WAV with a 44-byte header (what ffmpeg writes for `-ar 16000 -ac 1`).
    private static func readWAV(_ path: String) -> [Float]? {
        guard let data = FileManager.default.contents(atPath: path), data.count > 44 else { return nil }
        return data.dropFirst(44).withUnsafeBytes { raw in
            raw.bindMemory(to: Int16.self).map { Float(Int16(littleEndian: $0)) / 32768 }
        }
    }

    /// Reads the user's spelling fixes (`vocabulary.txt`), if there is a file. Called at launch and before each dictation,
    /// so an edit takes effect at once.
    private func loadVocabulary() {
        guard let text = try? String(contentsOf: vocabularyURL, encoding: .utf8) else { return }
        let vocabulary = DictationVocabulary.parse(text)
        for problem in vocabulary.problems { log("dictation.vocabulary_problem", ["detail": problem]) }
        Task { [model] in await model.setVocabulary(vocabulary) }
    }

    // MARK: - The shortcut

    func holdBegan() {
        guard case .idle = state else { onPhase(.done(.busy)); return }
        if conversationBusy() { onPhase(.done(.busy)); return }

        switch DictationCapture.permission {
        case .denied, .restricted:
            onPhase(.done(.failed(title: "Microphone is off", message: "Allow ZENO under System Settings → Privacy & Security → Microphone.")))
            return
        case .notDetermined:
            Task {
                let granted = await DictationCapture.requestPermission()
                if !granted { onPhase(.done(.failed(title: "Microphone is off", message: "Allow ZENO under System Settings → Privacy & Security → Microphone."))) }
            }
            return
        default:
            break
        }

        loadVocabulary()
        do {
            try capture.start()
        } catch {
            log("dictation.start_failed", ["message": "\(error)"])
            onPhase(.done(.failed(title: "Microphone problem", message: "\(error)")))
            return
        }
        state = .listening(since: ProcessInfo.processInfo.systemUptime, target: inserter.currentTarget())
        playSound(.start)
        onPhase(.listening)
        log("dictation.start", ["app": inserter.currentTarget().name])
    }

    func holdEnded() {
        guard case .listening(let since, let target) = state else { return }
        let heldFor = ProcessInfo.processInfo.systemUptime - since
        let samples = capture.stop()
        playSound(.stop)
        state = .working
        finish(samples, heldFor: heldFor, target: target)
    }

    /// The hold was spoiled (another key) or Esc: throw the recording away.
    func cancel() {
        switch state {
        case .listening:
            capture.cancel()
            state = .idle
            onPhase(.cancelled)
            log("dictation.cancelled", [:])
        case .working:
            work?.cancel()
            work = nil
            state = .idle
            onPhase(.cancelled)
            log("dictation.cancelled", ["stage": "working"])
        case .idle:
            break
        }
    }

    // MARK: - Finishing

    private func finish(_ samples: [Float], heldFor: Double, target: TextInserter.Target) {
        let seconds = DictationAudio.seconds(samples)
        if seconds < tooShort {
            end(.tooShort, ["seconds": seconds])
            return
        }
        guard DictationAudio.hasSpeech(samples) else {
            end(.noSpeech, ["seconds": (seconds * 10).rounded() / 10, "peak": Double(DictationAudio.peak(samples))])
            return
        }
        onPhase(.transcribing)
        let clipped = DictationAudio.clipped(samples)

        work = Task { [weak self] in
            guard let self else { return }
            let started = ProcessInfo.processInfo.systemUptime
            // The model is normally loaded at launch; if not, wait for it here and say so.
            if await !self.model.isLoaded {
                self.onPhase(.loading(detail: DictationModel.isDownloaded ? "Almost ready" : "First use: downloading, about 450 MB"))
                await self.modelLoading?.value
                if await !self.model.isLoaded {
                    self.end(.failed(title: "Speech model missing", message: self.modelError ?? "The speech model did not load."), [:])
                    return
                }
                self.onPhase(.transcribing)
            }
            do {
                let text = await self.model.polish(SpokenPunctuation.apply(to: try await self.model.transcribe(samples)))
                let transcribeMs = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
                if Task.isCancelled { return }
                guard !text.isEmpty else { self.end(.noSpeech, ["seconds": seconds, "reason": "empty transcript"]); return }

                let result = await self.inserter.insert(text, into: target)
                if Task.isCancelled { return }
                let words = text.split { $0.isWhitespace }.count
                var fields: [String: Any] = ["seconds": (seconds * 10).rounded() / 10, "words": words, "transcribeMs": transcribeMs,
                                             "totalMs": Int((ProcessInfo.processInfo.systemUptime - started) * 1000),
                                             "app": target.name, "clipped": clipped]
                switch result {
                case .typed:
                    self.end(.typed(words: words), fields)
                case .copied(let reason):
                    fields["reason"] = reason
                    self.end(.copied(reason: reason), fields)
                }
            } catch {
                self.end(.failed(title: "Couldn't transcribe", message: "\(error)"), ["message": "\(error)"])
            }
        }
    }

    private func end(_ outcome: DictationOutcome, _ fields: [String: Any]) {
        state = .idle
        work = nil
        onPhase(.done(outcome))
        var all = fields
        all["outcome"] = Self.name(of: outcome)
        log("dictation.end", all)
    }

    private static func name(of outcome: DictationOutcome) -> String {
        switch outcome {
        case .typed: "typed"
        case .copied: "copied"
        case .noSpeech: "no_speech"
        case .tooShort: "too_short"
        case .busy: "busy"
        case .failed: "failed"
        }
    }

    func stop() {
        work?.cancel()
        capture.cancel()
        capture.cleanup()
    }
}
