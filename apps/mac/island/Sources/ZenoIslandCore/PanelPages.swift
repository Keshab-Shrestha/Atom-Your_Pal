// ADR-084 (Lantern, Task 4.4): the panel has two word tabs, Conversation and Settings. The old Status tab lives on as
// the "now" card at the top of Settings, and every Settings page is reachable from Settings home: from a row, or (AI
// model) from the card's "Change model".

/// The panel's tabs.
public enum PanelTab: String, CaseIterable, Identifiable, Sendable {
    case conversation = "Conversation"
    case settings = "Settings"
    public var id: String { rawValue }
}

/// One page inside the Settings tab (ADR-057).
public enum SettingsPage: String, CaseIterable, Identifiable, Sendable {
    case examples = "What can I ask?"
    case appearance = "Appearance"
    case model = "AI model"
    case shortcuts = "Shortcuts"
    case dictation = "Dictation"
    case pal = "Pal"
    case memory = "Memory"
    case general = "General"
    public var id: String { rawValue }

    /// A monochrome glyph for the page's row (outline symbols, drawn in secondary text: no coloured tiles).
    public var symbol: String {
        switch self {
        case .examples: "magnifyingglass"
        case .appearance: "paintpalette"
        case .model: "sparkles"
        case .shortcuts: "command"
        case .dictation: "mic"
        case .pal: "face.smiling"
        case .memory: "brain"
        case .general: "gearshape"
        }
    }
}

/// How Settings home is laid out: the "now" card, then two groups of rows. AI model has no row; the card's
/// "Change model" opens it, next to the model it names.
public enum SettingsHome {
    public static let groups: [[SettingsPage]] = [
        [.examples, .shortcuts, .dictation],
        [.appearance, .pal, .memory, .general],
    ]
    /// The page the now card's "Change model" opens.
    public static let changeModel = SettingsPage.model

    /// Every page reachable from home, in order: the card's link first, then the rows.
    public static var reachable: [SettingsPage] { [changeModel] + groups.flatMap { $0 } }
}

/// What the "now" card says: everything the Status tab showed, in words, ready to draw. Built from the runtime's
/// status, the model list and the plan usage; the view adds no facts of its own.
public struct NowFacts: Sendable, Equatable {
    /// One timing under "Last turn", e.g. ("Transcribing", "0.6 s").
    public struct Timing: Sendable, Equatable {
        public var title: String
        public var value: String
        public var detail: String?
    }

    /// The provider, e.g. "Claude (my plan)", and the model replying, e.g. "Claude Opus 5.5".
    public var provider: String
    public var model: String
    public var microphone: String
    public var voice: String
    public var voiceLoaded: Bool
    /// The last turn in one phrase ("2.7 s to first sound"), or nil before the first turn.
    public var lastTurn: String?
    /// Every stage of the last turn, shown when "Last turn" is opened. Empty before the first turn.
    public var timings: [Timing]
    public var problem: IslandStatus.Problem?
    public var usage: PlanUsage?

    public init(status: IslandStatus, info: ModelInfo?, usage: PlanUsage?) {
        provider = info?.currentProvider?.name ?? status.provider.capitalized
        let name = info?.currentModelName ?? status.modelName
        model = name.isEmpty ? "—" : name
        microphone = status.microphone.isEmpty ? "No microphone" : status.microphone
        voiceLoaded = status.voiceLoaded
        voice = status.voiceLoaded ? "Voice ready" : "Voice not loaded"
        problem = status.lastProblem
        self.usage = usage.flatMap { $0.isEmpty ? nil : $0 }
        guard let t = status.lastTimings else {
            lastTurn = nil
            timings = []
            return
        }
        lastTurn = t.firstSoundMs.map { "\(Self.seconds($0)) to first sound" } ?? "AI reply in \(Self.seconds(t.modelMs))"
        timings = [
            Timing(title: "You spoke", value: Self.seconds(t.speechMs)),
            Timing(title: "Transcribing", value: Self.seconds(t.transcriptionMs)),
            Timing(title: "AI reply", value: Self.seconds(t.modelMs)),
        ] + (t.firstSoundMs.map { [Timing(title: "First sound", value: Self.seconds($0), detail: "From letting go to hearing ZENO")] } ?? [])
    }

    public static func seconds(_ ms: Int) -> String { String(format: "%.1f s", Double(ms) / 1000) }

    /// A turn's timings in one quiet line, shown under a reply on hover.
    public static func summary(_ t: TurnTimings) -> String {
        var parts = ["heard \(seconds(t.transcriptionMs))", "AI \(seconds(t.modelMs))"]
        if let first = t.firstSoundMs { parts.append("first sound \(seconds(first))") }
        return parts.joined(separator: " · ")
    }
}
