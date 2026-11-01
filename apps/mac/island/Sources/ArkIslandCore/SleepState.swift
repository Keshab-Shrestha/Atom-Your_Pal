/// Whether the Mac's screens are asleep or the session is locked (ADR-076). While either is true the island pauses:
/// Pal's frame timer stops and the microphone is not prepared (preparing it while locked hung on Core Audio,
/// TASK.md 0.5.10). Everything resumes once both are false.
public struct SleepState: Sendable, Equatable {
    public enum Signal: Sendable, Equatable {
        case screensSlept, screensWoke, locked, unlocked
    }

    public private(set) var asleep = false
    public private(set) var locked = false

    public init() {}

    public var paused: Bool { asleep || locked }

    /// Applies one notification. Returns true when `paused` changed, so the caller pauses or resumes once.
    @discardableResult
    public mutating func apply(_ signal: Signal) -> Bool {
        let was = paused
        switch signal {
        case .screensSlept: asleep = true
        case .screensWoke: asleep = false
        case .locked: locked = true
        case .unlocked: locked = false
        }
        return paused != was
    }
}
