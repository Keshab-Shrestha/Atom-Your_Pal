/// Avatars (ADR-085): Keshab's exported images, one per character and expression, at
/// `assets/avatars/<character>/<expression>.png` (spec in assets/avatars/README.md). This picks which image a moment
/// shows; the app loads the files. A missing image falls back along `fallbacks`, and to today's drawing at the end.
public enum AvatarExpression: String, Sendable, Equatable, CaseIterable {
    case neutral, happy, worried
    /// Helpers only: a job is running.
    case working

    public var fileName: String { rawValue + ".png" }

    /// The images to try, in order. Nil from all of them means "draw today's Pal or helper mark".
    public var fallbacks: [AvatarExpression] {
        switch self {
        case .neutral: [.neutral]
        default: [self, .neutral]
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
}
