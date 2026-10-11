import Foundation

/// ADR-093: how the on-screen 2D pixel Pal moves, as a pure function of the moment: its pose (from `PixelPal`), which
/// way its eyes look, a small bob, the squash of a click, the wobble of dizziness, and the "z"s of a nap. Pixel
/// motion: frames change a few times a second, as in the office floor.
public struct PixelPalFrame: Sendable, Equatable {
    public var pose: PixelPal.Pose
    /// -1 left, 0 ahead, 1 right (as seen on screen).
    public var look: Int
    /// Art pixels down (positive) or up.
    public var bob: Int
    /// Width and height factors (1 = as drawn).
    public var squashX: Double
    public var squashY: Double
    /// Degrees, clockwise.
    public var wobble: Double
    /// Napping: "z"s drift up beside it.
    public var sleeping: Bool
    /// ADR-093: listening with the microphone capturing ("Speak now"): sound bars pulse beside it.
    public var hearing: Bool = false
}

public enum PixelPalMotion {
    /// How far the gaze must point (design points, from `PalGaze`) before the eyes turn.
    static let lookThreshold = 0.8

    /// The frame for `mood` at `time` seconds; `gazeX` from `PalGaze` while Pal notices the pointer; a reaction playing
    /// and how far through it is (0...1).
    /// `micLive`: the microphone is capturing (`mic.ready`); until then a listening Pal waits, then it says "speak now".
    public static func frame(mood: PetBrain.Mood, time: Double, gazeX: Double = 0, micLive: Bool = false, reaction: PalReaction? = nil, progress: Double = 0) -> PixelPalFrame {
        var f = PixelPalFrame(pose: .idle, look: 0, bob: 0, squashX: 1, squashY: 1, wobble: 0, sleeping: false)
        let beat = Int((time * 2).rounded(.down))
        switch mood {
        case .resting, .floating:
            f.pose = beat % 6 < 3 ? .idle : .bob
            // A blink now and then: one frame in every few seconds.
            if Int((time * 8).rounded(.down)) % 37 == 0 { f.pose = .blink }
        case .listening:
            // Waiting for the microphone: still, eyes ahead. Capturing: arms up and sound bars ("speak now").
            f.pose = micLive ? .cheer : .idle
            f.bob = micLive ? beat % 2 : 0
            f.hearing = micLive
        case .thinking:
            f.pose = beat % 4 < 2 ? .idle : .bob
            f.look = (Int((time / 0.8).rounded(.down)) % 2 == 0) ? -1 : 1
        case .speaking:
            f.pose = Int((time * 6).rounded(.down)) % 2 == 0 ? .idle : .bob
        case .worried:
            f.pose = .sad
        case .napping:
            f.pose = .blink
            f.bob = Int((time / 1.5).rounded(.down)) % 2
            f.sleeping = true
        case .carried:
            f.pose = .cheer
        }
        if mood == .resting || mood == .floating {
            f.look = gazeX > lookThreshold ? 1 : gazeX < -lookThreshold ? -1 : 0
        }
        guard let reaction else { return f }
        let p = min(max(progress, 0), 1)
        switch reaction {
        case .hello:
            f.pose = .cheer
            f.bob = -Int((sin(p * .pi) * 3).rounded())
        case .squish:
            let s = sin(p * .pi) * 0.2
            f.squashX = 1 + s
            f.squashY = 1 - s
        case .dizzy:
            f.pose = Int(p * 10) % 2 == 0 ? .blink : .sad
            f.wobble = sin(p * 6 * .pi) * 14 * (1 - p)
        case .yawn:
            f.pose = .blink
            f.squashY = 1 + sin(p * .pi) * 0.08
        }
        return f
    }
}
