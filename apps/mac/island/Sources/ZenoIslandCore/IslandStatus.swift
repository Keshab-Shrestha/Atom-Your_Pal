/// What the compact island shows, derived from the runtime's status and events (ADR-038):
/// a state with a title, a short detail line, and whether the level meter is live.
/// Also keeps what the Status tab shows: provider, model, microphone, last timings and last problem.
public struct IslandStatus: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        case starting, ready, listening, transcribing, thinking, speaking, notice, problem
    }

    /// An error as the Status tab shows it: a title and the runtime's full message (with its fix).
    public struct Problem: Sendable, Equatable {
        public var title: String
        /// The full message, not shortened.
        public var message: String

        public init(title: String, message: String) {
            self.title = title
            self.message = message
        }
    }

    public private(set) var kind = Kind.starting
    public private(set) var title = "Starting"
    /// One short line under the title (may be empty).
    public private(set) var detail = "Loading voice"
    /// The model in use, e.g. "Gemini 3.6 Flash", from the `ready` event.
    public private(set) var modelName = ""
    /// The microphone in use, from `ready`.
    public private(set) var microphone = ""
    /// The provider and model ids, from `ready` and `info`.
    public private(set) var provider = ""
    public private(set) var model = ""
    /// False if the voice failed to load, from `ready`.
    public private(set) var voiceLoaded = false
    /// The last completed turn's timings.
    public private(set) var lastTimings: TurnTimings?
    /// The last error, kept until a later error replaces it.
    public private(set) var lastProblem: Problem?
    /// The problem lasts until ZENO itself recovers (stopped, settings), so seeing it does not clear it.
    private var persistent = false

    public init() {}

    /// The meter follows the microphone only while listening.
    public var showsLevel: Bool { kind == .listening }

    /// ZENO is in the middle of a turn: the island stays shown.
    public var isBusy: Bool {
        switch kind {
        case .listening, .transcribing, .thinking, .speaking: true
        default: false
        }
    }

    /// A notice or problem the user should see before the island hides.
    public var needsAttention: Bool { kind == .notice || kind == .problem }

    public mutating func apply(_ status: RuntimeSupervisor.Status) {
        switch status {
        case .stopped: set(.problem, "Stopped", "ZENO is not running", persistent: true)
        case .running: set(.starting, "Starting", "Loading voice")
        case .restarting: set(.starting, "Restarting", "ZENO stopped unexpectedly")
        case .configError(let message): set(.problem, "Check settings", IslandStatus.short(message), persistent: true)
        case .failed: set(.problem, "Stopped", "Keeps stopping. See logs/zeno.log", persistent: true)
        }
    }

    public mutating func apply(_ event: IslandEvent) {
        switch event {
        case .ready(let info):
            modelName = IslandStatus.displayName(provider: info.provider, model: info.model)
            provider = info.provider
            model = info.model
            microphone = info.microphone
            voiceLoaded = info.voice
            set(.ready, "Ready", modelName)
        case .info(let info):
            modelName = info.currentModelName
            provider = info.provider
            model = info.model
            if kind == .ready { detail = modelName }
        case .turnComplete(let timings):
            lastTimings = timings
        case .state(let state):
            switch state {
            case .idle:
                // A notice or problem from the turn that just ended stays until it has been seen.
                if !needsAttention { set(.ready, "Ready", modelName) }
            case .listening: set(.listening, "Listening", "")
            case .transcribing: set(.transcribing, "Transcribing", "")
            case .thinking: set(.thinking, "Thinking", modelName)
            case .speaking: set(.speaking, "Speaking", "")
            }
        case .micSilent:
            if kind == .listening { detail = "Can't hear you. Check the microphone" }
        case .notice(let noticeKind, _):
            set(.notice, IslandStatus.noticeTitle(noticeKind), IslandStatus.noticeDetail(noticeKind))
        case .error(let error):
            let title = IslandStatus.errorTitle(error)
            lastProblem = Problem(title: title, message: error.message)
            set(.problem, title, IslandStatus.short(error.message))
        default:
            break
        }
    }

    /// Back to Ready once a notice or problem has been seen (when the island hides).
    public mutating func acknowledge() {
        if needsAttention && !persistent { set(.ready, "Ready", modelName) }
    }

    private mutating func set(_ kind: Kind, _ title: String, _ detail: String, persistent: Bool = false) {
        self.kind = kind
        self.title = title
        self.detail = detail
        self.persistent = persistent
    }

    // MARK: - Wording

    static func noticeTitle(_ kind: String) -> String {
        switch kind {
        case "too_short": "Too short"
        case "no_speech": "Didn't catch that"
        case "mic_not_ready": "Microphone starting"
        default: "Nothing sent"
        }
    }

    static func noticeDetail(_ kind: String) -> String {
        switch kind {
        case "too_short": "Hold the keys while you speak"
        case "no_speech": "Nothing heard. Try speaking closer"
        case "mic_not_ready": "Try again in a moment"
        default: ""
        }
    }

    static func errorTitle(_ error: RuntimeError) -> String {
        switch error.kind {
        case "rate_limit": "Model limit reached"
        case "auth": "Model key rejected"
        case "unavailable": "Model unreachable"
        case "timeout": "Model too slow"
        default:
            switch error.stage {
            case "microphone": "Microphone problem"
            case "transcription": "Couldn't transcribe"
            case "model": "Model error"
            case "speech": "Couldn't speak"
            case "config": "Check settings"
            case "settings": "Can't switch model"
            default: "Something went wrong"
            }
        }
    }

    /// The first sentence of a message, kept to one line.
    static func short(_ message: String, limit: Int = 44) -> String {
        let firstLine = message.split(separator: "\n").first.map(String.init) ?? message
        var sentence = firstLine
        if let end = firstLine.range(of: ". ") { sentence = String(firstLine[..<end.lowerBound]) }
        let trimmed = sentence.trimmingCharacters(in: .whitespaces)
        return trimmed.count <= limit ? trimmed : String(trimmed.prefix(limit - 1)) + "…"
    }

    /// "gemini-3.6-flash" → "Gemini 3.6 Flash"; "claude-haiku-4-5-20251001" → "Claude Haiku 4.5".
    public static func displayName(provider: String, model: String) -> String {
        var parts = model.split(separator: "-").map(String.init)
            .filter { !($0.count == 8 && $0.allSatisfy(\.isNumber)) } // dated snapshot suffix
        var words: [String] = []
        while !parts.isEmpty {
            let part = parts.removeFirst()
            if let last = words.last, last.allSatisfy({ $0.isNumber || $0 == "." }), part.allSatisfy(\.isNumber), part.count <= 2 {
                words[words.count - 1] = last + "." + part // "4" "5" → "4.5"
            } else {
                words.append(part.first?.isLetter == true ? part.prefix(1).uppercased() + part.dropFirst() : part)
            }
        }
        return words.isEmpty ? provider.capitalized : words.joined(separator: " ")
    }
}
