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
    /// The dictation settings, read at the start of each dictation (so a change applies at once).
    var options: () -> DictationOptions = { DictationOptions() }
    /// The words heard so far, cleaned up, while listening (the live preview).
    var onPreview: (String) -> Void = { _ in }

    enum Sound { case start, stop }

    /// Talk through the prepared microphone and Parakeet (ADR-063): the words go to ZENO instead of being typed.
    var onTalk: (TalkPhase) -> Void = { _ in }
    enum TalkPhase: Equatable { case listening, heard(String), nothing, failed(String), cancelled }
    private var talkSince: Double?
    private var talkWork: Task<Void, Never>?
    /// Parakeet finished loading (`model.isLoaded` is async; this is for synchronous checks).
    private var modelReady = false

    private let capture = DictationCapture()
    private let model = DictationModel()
    private let inserter = TextInserter()
    private let vocabularyURL: URL

    private enum State {
        case idle
        /// `handsFree`: a tap started it (or turned a hold into one), so letting go of the keys does nothing and the next tap finishes it.
        case listening(since: Double, target: TextInserter.Target, handsFree: Bool, options: DictationOptions)
        case working
    }
    private var state = State.idle
    private var modelLoading: Task<Void, Never>?
    private var modelError: String?
    private var work: Task<Void, Never>?
    /// Reads the growing recording while listening (live preview, and the hands-free time limits).
    private var watcher: Task<Void, Never>?

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
                await MainActor.run { self.modelError = nil; self.modelReady = true; self.log("dictation.model_ready", ["seconds": (seconds * 10).rounded() / 10]) }
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
                    let text = await self.clean(try await self.model.transcribe(samples), removeFillers: self.options().removeFillers)
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
        // A tap while a hands-free dictation is listening finishes it.
        if case .listening(let since, let target, true, _) = state {
            finishListening(since: since, target: target)
            return
        }
        guard case .idle = state, talkSince == nil, talkWork == nil else { onPhase(.done(.busy)); return }
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
        let current = options()
        let handsFree = DictationActivation.startsHandsFree(current.mode)
        state = .listening(since: ProcessInfo.processInfo.systemUptime, target: inserter.currentTarget(), handsFree: handsFree, options: current)
        playSound(.start)
        onPhase(handsFree ? .listeningHandsFree : .listening)
        log("dictation.start", ["app": inserter.currentTarget().name, "mode": current.mode.rawValue])
        startWatching()
    }

    func holdEnded() {
        guard case .listening(let since, let target, let handsFree, let options) = state else { return }
        let heldFor = ProcessInfo.processInfo.systemUptime - since
        switch DictationActivation.released(mode: options.mode, heldFor: heldFor, handsFree: handsFree) {
        case .stop:
            finishListening(since: since, target: target)
        case .latch:
            // A quick tap: keep listening, hands-free, until the next tap.
            state = .listening(since: since, target: target, handsFree: true, options: options)
            onPhase(.listeningHandsFree)
            log("dictation.latched", ["heldMs": Int(heldFor * 1000)])
        case .ignore:
            break
        }
    }

    /// Stops the microphone and sends the recording to be typed.
    private func finishListening(since: Double, target: TextInserter.Target) {
        guard case .listening(_, _, _, let options) = state else { return }
        let heldFor = ProcessInfo.processInfo.systemUptime - since
        watcher?.cancel()
        watcher = nil
        let samples = capture.stop()
        playSound(.stop)
        state = .working
        finish(samples, heldFor: heldFor, target: target, options: options)
    }

    /// The hold was spoiled by another key: throw the recording away. A hands-free dictation is not affected,
    /// because the only hold that can be spoiled then is the tap that finishes it.
    func holdCancelled() {
        if case .listening(_, _, let handsFree, _) = state, !handsFree { cancel() }
    }

    /// Esc: throw the recording away.
    func cancel() {
        watcher?.cancel()
        watcher = nil
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

    // MARK: - Talk (ADR-063)

    /// Starts listening for a question. False when this path cannot be used right now (model not loaded, no microphone
    /// permission, dictating): the caller falls back to the runtime's own microphone and Whisper.
    func talkBegan() -> Bool {
        guard modelReady, case .idle = state, talkSince == nil, DictationCapture.permission == .authorized else { return false }
        talkWork?.cancel()
        talkWork = nil
        loadVocabulary()
        do {
            try capture.start()
        } catch {
            log("talk.start_failed", ["message": "\(error)"])
            return false
        }
        talkSince = ProcessInfo.processInfo.systemUptime
        onTalk(.listening)
        log("talk.start", [:])
        return true
    }

    /// The keys came up: transcribe what was said and hand it over.
    func talkEnded() {
        guard let since = talkSince else { return }
        talkSince = nil
        let samples = capture.stop()
        let seconds = DictationAudio.seconds(samples)
        let held = Int((ProcessInfo.processInfo.systemUptime - since) * 1000)
        guard seconds >= tooShort, DictationAudio.hasSpeech(samples) else {
            log("talk.end", ["outcome": "no_speech", "heldMs": held])
            onTalk(.nothing)
            return
        }
        let removeFillers = options().removeFillers
        talkWork = Task { [weak self] in
            guard let self else { return }
            let started = ProcessInfo.processInfo.systemUptime
            do {
                let text = await self.clean(try await self.model.transcribe(samples), removeFillers: removeFillers)
                if Task.isCancelled { return }
                self.talkWork = nil
                self.log("talk.end", ["outcome": text.isEmpty ? "no_speech" : "heard", "heldMs": held,
                                      "transcribeMs": Int((ProcessInfo.processInfo.systemUptime - started) * 1000),
                                      "clipped": DictationAudio.clipped(samples)])
                self.onTalk(text.isEmpty ? .nothing : .heard(text))
            } catch {
                if Task.isCancelled { return }
                self.talkWork = nil
                self.log("talk.end", ["outcome": "failed", "message": "\(error)"])
                self.onTalk(.failed("\(error)"))
            }
        }
    }

    // MARK: - Follow-up (ADR-067)

    private var followUp: Task<Void, Never>?
    /// True while the microphone is open for an answer to ZENO's question.
    var isFollowingUp: Bool { followUp != nil }

    /// ZENO just asked something: listen for an answer without keys. Ends by itself when the user stops speaking
    /// (the answer is sent like Talk) or when nobody speaks within a few seconds (closed quietly, nothing sent).
    @discardableResult
    func followUpBegan() -> Bool {
        guard followUp == nil, talkBegan() else { return false }
        log("followup.start", [:])
        let opened = ProcessInfo.processInfo.systemUptime
        followUp = Task { [weak self] in
            var endpoint = SpeechEndpoint()
            var seen = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000)
                guard let self, !Task.isCancelled, self.talkSince != nil else { return }
                let (total, clip) = self.capture.snapshot(maxSamples: DictationAudio.sampleRate)
                let fresh = min(max(total - seen, 0), clip.count)
                seen = total
                let rms = SpeechEndpoint.rms(clip.suffix(fresh))
                switch endpoint.update(elapsed: ProcessInfo.processInfo.systemUptime - opened, rms: rms) {
                case .listen:
                    continue
                case .finish:
                    self.followUp = nil
                    self.log("followup.heard", [:])
                    self.talkEnded()
                    return
                case .giveUp:
                    self.followUp = nil
                    self.log("followup.quiet", [:])
                    self.talkCancelled()
                    return
                }
            }
        }
        return true
    }

    /// Stops listening for an answer (the Talk keys, Esc, a new turn), sending nothing.
    func followUpCancelled() {
        guard let task = followUp else { return }
        task.cancel()
        followUp = nil
        talkCancelled()
    }

    /// Esc, or the hold was spoiled: nothing is sent.
    func talkCancelled() {
        if let task = followUp { task.cancel(); followUp = nil }
        guard talkSince != nil || talkWork != nil else { return }
        if talkSince != nil { capture.cancel() }
        talkSince = nil
        talkWork?.cancel()
        talkWork = nil
        log("talk.cancelled", [:])
        onTalk(.cancelled)
    }

    // MARK: - Finishing

    /// The text as it is typed: fillers out (if on), spoken punctuation turned into marks, then the user's spelling fixes.
    private func clean(_ raw: String, removeFillers: Bool) async -> String {
        let text = removeFillers ? FillerWords.remove(from: raw) : raw
        return await model.polish(SpokenPunctuation.apply(to: text))
    }

    // MARK: - Watching while listening

    /// While listening: every `DictationPreview.interval` seconds, reads what has been said so far and shows it
    /// (if the live preview is on), and applies the hands-free limits (a forgotten tap, or a tap and then silence).
    private func startWatching() {
        watcher?.cancel()
        guard case .listening(let since, let target, _, let options) = state else { return }
        watcher = Task { [weak self] in
            var lastDecoded = 0
            var sawSpeech = false
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(Int(DictationPreview.interval * 1000)))
                guard let self, !Task.isCancelled, case .listening(_, _, let handsFree, _) = self.state else { return }
                let window = Int(DictationPreview.windowSeconds * Double(DictationAudio.sampleRate))
                let (total, clip) = self.capture.snapshot(maxSamples: window)
                let elapsed = ProcessInfo.processInfo.systemUptime - since

                if handsFree {
                    if elapsed >= DictationActivation.longestHandsFree {
                        self.log("dictation.limit", ["stage": "longest", "seconds": Int(elapsed)])
                        self.finishListening(since: since, target: target)
                        return
                    }
                    if !sawSpeech {
                        sawSpeech = DictationAudio.hasSpeech(clip)
                        if !sawSpeech && elapsed >= DictationActivation.silentHandsFree {
                            self.log("dictation.limit", ["stage": "silent", "seconds": Int(elapsed)])
                            self.capture.cancel()
                            self.state = .idle
                            self.watcher = nil
                            self.end(.noSpeech, ["seconds": Int(elapsed), "reason": "silent hands-free"])
                            return
                        }
                    }
                }

                guard options.livePreview, DictationPreview.shouldDecode(total: total, lastDecoded: lastDecoded),
                      DictationAudio.hasSpeech(clip) else { continue }
                lastDecoded = total
                guard let raw = try? await self.model.transcribe(clip), !Task.isCancelled,
                      case .listening = self.state else { continue }
                let shown = DictationPreview.display(await self.clean(raw, removeFillers: options.removeFillers))
                if case .listening = self.state, !Task.isCancelled { self.onPreview(shown) }
            }
        }
    }

    private func finish(_ samples: [Float], heldFor: Double, target: TextInserter.Target, options: DictationOptions) {
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
                let text = await self.clean(try await self.model.transcribe(samples), removeFillers: options.removeFillers)
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
        watcher?.cancel()
        work?.cancel()
        capture.cancel()
        capture.cleanup()
    }
}
