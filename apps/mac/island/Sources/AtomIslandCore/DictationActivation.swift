import Foundation

/// How the dictation shortcut starts and ends a dictation (ADR-050). Pure, so every rule is unit-tested
/// without a keyboard.

/// The way the user starts and stops dictating.
public enum DictationMode: String, CaseIterable, Sendable, Codable, Identifiable {
    /// Hold the keys while speaking; let go to type.
    case hold
    /// Tap to start, tap again to finish.
    case toggle
    /// A long press is hold-to-talk; a quick tap starts a hands-free dictation that the next tap finishes.
    case automatic

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .hold: "Hold"
        case .toggle: "Tap"
        case .automatic: "Hold or tap"
        }
    }

    public var detail: String {
        switch self {
        case .hold: "Hold the keys while you speak, let go to type"
        case .toggle: "Tap to start, tap again to finish"
        case .automatic: "Hold to talk, or tap once and tap again to finish"
        }
    }
}

/// What the dictation settings say right now.
public struct DictationOptions: Sendable, Equatable {
    public var mode: DictationMode
    /// Show the words on screen while speaking.
    public var livePreview: Bool
    /// Drop "um", "uh" and the like from the text.
    public var removeFillers: Bool

    public init(mode: DictationMode = .automatic, livePreview: Bool = true, removeFillers: Bool = true) {
        self.mode = mode
        self.livePreview = livePreview
        self.removeFillers = removeFillers
    }
}

public enum DictationActivation {
    /// A press shorter than this is a tap (hands-free start), not hold-to-talk.
    public static let tapCutoff = 0.4

    /// A hands-free dictation stops by itself after this long, so one forgotten tap cannot record all day.
    public static let longestHandsFree = 300.0

    /// A hands-free dictation in which nothing but silence was heard is dropped after this long.
    public static let silentHandsFree = 20.0

    /// What letting go of the keys does.
    public enum Release: Sendable, Equatable {
        /// Finish and type.
        case stop
        /// A quick tap: keep listening until the next tap.
        case latch
        /// Nothing: the dictation carries on (or was already hands-free).
        case ignore
    }

    /// Whether a dictation starts out hands-free (Tap mode: the release then does nothing).
    public static func startsHandsFree(_ mode: DictationMode) -> Bool { mode == .toggle }

    /// What to do when the keys come up, `heldFor` seconds after the dictation started.
    public static func released(mode: DictationMode, heldFor: Double, handsFree: Bool) -> Release {
        if handsFree { return .ignore }
        switch mode {
        case .hold: return .stop
        case .toggle: return .ignore
        case .automatic: return heldFor < tapCutoff ? .latch : .stop
        }
    }
}
