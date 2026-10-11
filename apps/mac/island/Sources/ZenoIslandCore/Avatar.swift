/// Avatars (ADR-085): Keshab's exported images, one per character and expression, at
/// `assets/avatars/<character>/<expression>.png` (spec in assets/avatars/README.md). This picks which image a moment
/// shows; the app loads the files. A missing image falls back along `fallbacks`, and to today's drawing at the end.
public enum AvatarExpression: String, Sendable, Equatable, CaseIterable {
    case neutral, happy, listening, thinking, speaking
    case speakingClosed = "speaking-closed"
    case worried, sleepy, surprised
    /// Helpers only: a job is running.
    case working

    /// Pal's nine, in the README's order.
    public static let pal: [AvatarExpression] = [.neutral, .happy, .listening, .thinking, .speaking, .speakingClosed, .worried, .sleepy, .surprised]
    /// Each helper's four.
    public static let helper: [AvatarExpression] = [.neutral, .working, .happy, .worried]

    public var fileName: String { rawValue + ".png" }

    /// The images to try, in order. Nil from all of them means "draw today's Pal or helper mark".
    public var fallbacks: [AvatarExpression] {
        switch self {
        case .neutral: [.neutral]
        case .speakingClosed: [.speakingClosed, .speaking, .neutral]
        default: [self, .neutral]
        }
    }

    /// Pal's expression for its mood, the reaction playing (if any) and, while speaking, whether the mouth is open.
    public static func pal(mood: PetBrain.Mood, reaction: PalReaction?, mouthOpen: Bool) -> AvatarExpression {
        switch reaction {
        case .hello: return .happy
        case .squish, .dizzy: return .surprised
        case .yawn: return .sleepy
        case nil: break
        }
        return switch mood {
        case .floating, .resting: .neutral
        case .listening: .listening
        case .thinking: .thinking
        case .speaking: mouthOpen ? .speaking : .speakingClosed
        case .worried: .worried
        case .napping: .sleepy
        case .carried: .surprised
        }
    }

    /// A helper's expression: working while any job runs, else from its newest job (happy when done, worried when
    /// it failed), else neutral.
    public static func helper(_ helper: Helper) -> AvatarExpression {
        if helper.jobs.contains(where: { $0.state == .running }) { return .working }
        return switch helper.jobs.first?.state {
        case .done: .happy
        case .failed: .worried
        default: .neutral
        }
    }

    /// The image's path inside the avatars folder, "sid/working.png". Nil for a character name that is not a plain
    /// lower-case folder name (helper ids come from the runtime: never let one reach outside the folder).
    public func path(character: String) -> String? {
        let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789-_")
        guard !character.isEmpty, character.count <= 32, character.allSatisfy(allowed.contains) else { return nil }
        return "\(character)/\(fileName)"
    }

    /// While speaking: open and closed mouth turns, about 6.4 a second, of uneven length so it reads as speech rather than
    /// a metronome. A pure function of time, like the rest of Pal's motion.
    public static func mouthOpen(at time: Double) -> Bool {
        var t = time.truncatingRemainder(dividingBy: mouthCycle)
        if t < 0 { t += mouthCycle }
        for (i, turn) in mouthTurns.enumerated() {
            if t < turn { return i % 2 == 0 }
            t -= turn
        }
        return false
    }

    /// Seconds per turn, alternating open, closed. An even count keeps open on even turns across cycles.
    static let mouthTurns = [0.08, 0.06, 0.10, 0.05, 0.07, 0.07, 0.12, 0.06, 0.08, 0.09]
    static let mouthCycle = mouthTurns.reduce(0, +)
}
