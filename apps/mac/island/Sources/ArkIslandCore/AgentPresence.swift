import Foundation

/// An agent's state at a glance, for the sidebar's live dot (2026-11-02, after Keshab's "Agent CRM workspace" reference).
public enum AgentPresence: String, Sendable, Equatable {
    /// A task runs now.
    case working
    /// A task waits for Keshab: held (a plan to review, an interrupt) or queued behind an answer.
    case waiting
    /// Paused by Keshab: it takes no new work.
    case paused
    case idle

    public init(_ helper: Helper) {
        if helper.jobs.contains(where: { $0.state == .running }) { self = .working }
        else if helper.jobs.contains(where: { $0.state == .queued && $0.held != nil }) { self = .waiting }
        else if helper.paused { self = .paused }
        else { self = .idle }
    }

    public var title: String {
        switch self {
        case .working: "Working"
        case .waiting: "Waiting for you"
        case .paused: "Paused"
        case .idle: "Idle"
        }
    }

    /// The order in the sidebar: what needs a look first.
    public var rank: Int {
        switch self {
        case .waiting: 0
        case .working: 1
        case .idle: 2
        case .paused: 3
        }
    }
}
