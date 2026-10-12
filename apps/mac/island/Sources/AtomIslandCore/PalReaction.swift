import Foundation

/// Where Pal's eyes look while ZENO is idle (ADR-073): toward the pointer, a few design points at most.
public enum PalGaze {
    /// Beyond this distance (screen points) Pal does not notice the pointer.
    public static let range = 400.0
    /// The furthest the eyes move, in Pal's 64-point design space.
    public static let maxOffset = 2.5
    /// Within this distance the glance shrinks, so the eyes do not swing while the pointer is on Pal.
    static let fullGlanceDistance = 80.0

    /// The eye offset for a pointer `dx`, `dy` screen points from Pal's eyes (screen y up). The result is in design
    /// points with y down. Zero beyond `range`, and zero unless Pal is awake and idle (floating or resting).
    public static func offset(dx: Double, dy: Double, mood: PetBrain.Mood) -> (x: Double, y: Double) {
        guard mood == .floating || mood == .resting else { return (0, 0) }
        let distance = hypot(dx, dy)
        guard distance > 0.5, distance <= range else { return (0, 0) }
        let glance = maxOffset * min(1, distance / fullGlanceDistance)
        return (dx / distance * glance, -dy / distance * glance)
    }
}

/// A short reaction Pal plays while ZENO is idle (ADR-073). Shown by body, light and face only.
public enum PalReaction: Sendable, Equatable {
    /// A click: a quick squash-and-stretch.
    case squish
    /// Three fast clicks: swirling eyes and a wobble.
    case dizzy
    /// Once per launch: a small bounce.
    case hello
    /// Falling asleep: one yawn.
    case yawn

    /// Seconds the reaction lasts.
    public var duration: Double {
        switch self {
        case .squish: 0.25
        case .dizzy: 2
        case .hello: 0.9
        case .yawn: 1.6
        }
    }

    /// Squash, wobble or bounce: left out when macOS's Reduce Motion is on. A yawn is only the face.
    public var moves: Bool { self != .yawn }

    /// The reaction a click gives. The third click of a quick run does nothing to the panel (ADR-051), so it is free.
    public static func forClick(count: Int) -> PalReaction { count >= 3 ? .dizzy : .squish }
}

/// Plays one reaction at a time. ZENO's state always wins: a turn, a problem or being carried ends a reaction at once.
public struct PalReactionPlayer: Sendable {
    private var current: PalReaction?
    private var startedAt = 0.0

    public init() {}

    /// Starts `reaction`, replacing any other. Ignored while ZENO is busy, and for moving reactions under Reduce Motion.
    public mutating func start(_ reaction: PalReaction, at now: Double, mood: PetBrain.Mood, reduceMotion: Bool) {
        guard !mood.isReacting, !(reduceMotion && reaction.moves) else { return }
        current = reaction
        startedAt = now
    }

    /// The reaction showing now and how far through it is (0...1), or nil.
    public mutating func active(at now: Double, mood: PetBrain.Mood) -> (reaction: PalReaction, progress: Double)? {
        guard let reaction = current else { return nil }
        let progress = (now - startedAt) / reaction.duration
        guard !mood.isReacting, progress >= 0, progress <= 1 else {
            current = nil
            return nil
        }
        return (reaction, progress)
    }
}
