import Foundation

// Quiet the Mac while the user speaks (2026-11-04, idea from atticus-mac "audio ducking"). Music and videos make the microphone hear
// them and make the speech harder to read. While ARK listens, the output volume drops to a fraction; when listening ends it goes
// back, but only if the user did not change the volume in between. This file is the plain state machine; the app reads and sets
// the volume.

public struct AudioDuck: Sendable, Equatable {
    /// The volume to leave while listening, as a share of the current one.
    public static let share = 0.25

    private var saved: Int?
    private var lowered: Int?

    public init() {}

    public var isDucked: Bool { saved != nil }

    /// Listening began with the output at `current` (0 to 100; nil: it cannot be read, e.g. a device with no volume). Returns the volume to set, or nil to leave it.
    public mutating func begin(current: Int?) -> Int? {
        guard saved == nil, let current, current > 5 else { return nil }
        let target = max(0, Int((Double(current) * Self.share).rounded()))
        saved = current
        lowered = target
        return target
    }

    /// Listening ended with the output now at `current`. Returns the volume to restore, or nil when the user changed it meanwhile (their choice stands) or nothing was lowered.
    public mutating func end(current: Int?) -> Int? {
        defer { saved = nil; lowered = nil }
        guard let saved, let lowered, current == lowered else { return nil }
        return saved
    }
}
