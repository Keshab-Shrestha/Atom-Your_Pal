import Foundation

/// Decides what to do when the runtime exits (docs/island-protocol.md, "Exit codes").
public struct RestartPolicy: Sendable {
    /// Exit code the runtime uses for a configuration error: show it, do not restart.
    public static let configErrorExitCode: Int32 = 78

    /// Waits before successive restarts, in seconds. The last value repeats.
    public var delays: [Double]
    /// A runtime that ran at least this long counts as healthy: the next failure starts the delays over.
    public var stableAfter: Double
    /// Give up after this many consecutive quick failures; something needs fixing first.
    public var maxConsecutiveFailures: Int

    private(set) public var consecutiveFailures = 0

    public init(delays: [Double] = [1, 2, 4, 8, 15, 30], stableAfter: Double = 30, maxConsecutiveFailures: Int = 6) {
        precondition(!delays.isEmpty)
        self.delays = delays
        self.stableAfter = stableAfter
        self.maxConsecutiveFailures = maxConsecutiveFailures
    }

    public enum Decision: Equatable, Sendable {
        /// The island asked it to stop: nothing to do.
        case stay
        case restart(after: Double)
        case configError
        case giveUp
    }

    /// Records an exit and decides the next step.
    /// - Parameters:
    ///   - exitCode: The process exit status (or 128 + signal when killed).
    ///   - uptime: Seconds the runtime ran.
    ///   - requested: Whether the island asked it to stop.
    public mutating func decide(exitCode: Int32, uptime: Double, requested: Bool) -> Decision {
        if requested { return .stay }
        if exitCode == Self.configErrorExitCode { return .configError }
        if uptime >= stableAfter { consecutiveFailures = 0 }
        consecutiveFailures += 1
        if consecutiveFailures > maxConsecutiveFailures { return .giveUp }
        return .restart(after: delays[min(consecutiveFailures - 1, delays.count - 1)])
    }

    /// Forget past failures, e.g. when the user restarts ZENO by hand.
    public mutating func reset() { consecutiveFailures = 0 }
}
