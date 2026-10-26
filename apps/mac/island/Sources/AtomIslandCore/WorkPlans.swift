import Foundation

// ADR-111: work plans. One big goal split into portions, each done by one agent. The notch shows one dot a portion; the
// Board shows the plan as a card. Pure: the runtime sends the state, this only reads it.

/// One portion of a work plan.
public struct PlanPortion: Sendable, Equatable, Identifiable {
    public enum State: String, Sendable, Equatable {
        case waiting, running, done, failed, stopped, blocked
    }
    public enum Recovery: String, Sendable, Equatable {
        case reported, repaired, working, waiting, blocked, failed, stopped, interrupted, unconfirmed
        case retryQueued = "retry-queued"
        case repairUnavailable = "repair-unavailable"

        public var needsReview: Bool {
            switch self {
            case .blocked, .failed, .stopped, .interrupted, .unconfirmed, .repairUnavailable: return true
            default: return false
            }
        }
    }

    public var n: Int
    public var agent: String
    public var name: String
    public var task: String
    /// The numbers of the portions it waits for.
    public var after: [Int]
    /// The Board task it became; nil while it waits.
    public var job: Int?
    /// Accepted retry report; the original Board task above is retained.
    public var resultJob: Int?
    public var repairUnavailable: Bool
    public var recovery: Recovery?
    public var state: State
    public var id: Int { n }

    public init(n: Int, agent: String, name: String, task: String, after: [Int] = [], job: Int? = nil, state: State = .waiting, resultJob: Int? = nil, repairUnavailable: Bool = false, recovery: Recovery? = nil) {
        self.n = n
        self.agent = agent
        self.name = name
        self.task = task
        self.after = after
        self.job = job
        self.state = state
        self.resultJob = resultJob
        self.repairUnavailable = repairUnavailable
        self.recovery = recovery
    }

    public var recoveryState: Recovery {
        if repairUnavailable { return .repairUnavailable }
        if let recovery { return recovery }
        switch state {
        case .done: return resultJob == nil ? .reported : .repaired
        case .running: return .working
        case .waiting: return .waiting
        case .blocked: return .blocked
        case .failed: return .failed
        case .stopped: return .stopped
        }
    }

    public var recoveryDetail: String? {
        switch recoveryState {
        case .interrupted: return "ATOM stopped before it could confirm this step. Review its history and any changed files before retrying."
        case .unconfirmed: return "ATOM cannot confirm this step's outcome from the saved records. Review it before continuing."
        case .failed: return "Review the failure and any existing changes before choosing Retry."
        case .stopped: return "Stopped work may already have changed files. Review the task before choosing Retry."
        case .repairUnavailable: return "The saved repair result needs review before continuing."
        case .blocked: return after.isEmpty ? "Waiting for earlier work to be reviewed." : "Waiting for " + after.map { "P\($0)" }.joined(separator: ", ") + " to finish or receive an approved repair."
        case .retryQueued: return "An explicit retry is queued. It has not started yet."
        default: return nil
        }
    }

    /// "Waiting for P1", "Working", "Done", ...
    public func stateText(portions: [PlanPortion]) -> String {
        switch recoveryState {
        case .interrupted: return "Interrupted · review needed"
        case .unconfirmed: return "Outcome unconfirmed"
        case .repairUnavailable: return "Repair needs review"
        case .retryQueued: return "Retry queued"
        default: break
        }
        switch state {
        case .waiting:
            let open = after.filter { n in portions.first { $0.n == n }?.state != .done }
            return open.isEmpty ? "Ready" : "Waits for " + open.map { "P\($0)" }.joined(separator: ", ")
        case .running: return "Working"
        case .done: return resultJob == nil ? "Done" : "Retry report accepted"
        case .failed: return "Failed"
        case .stopped: return "Stopped"
        case .blocked: return "Blocked"
        }
    }
}

/// A work plan with the state of each portion.
public struct WorkPlanItem: Sendable, Equatable, Identifiable {
    public var id: Int
    public var goal: String
    public var createdAt: Date?
    public var portions: [PlanPortion]
    public var complete: Bool
    public var stuck: Bool

    public init(id: Int, goal: String, createdAt: Date? = nil, portions: [PlanPortion], complete: Bool = false, stuck: Bool = false) {
        self.id = id
        self.goal = goal
        self.createdAt = createdAt
        self.portions = portions
        self.complete = complete
        self.stuck = stuck
    }

    /// The plan still goes on: not complete, not stuck.
    public var isActive: Bool { !complete && !stuck }
    public var doneCount: Int { portions.filter { $0.state == .done }.count }
    public var needsRecoveryReview: Bool { portions.contains { $0.recoveryState.needsReview } }
    public var recoveryTitle: String {
        portions.contains { $0.recoveryState == .interrupted } ? "Interrupted work needs review" : "Unfinished work needs review"
    }
    public var recoverySummary: String {
        let count: (PlanPortion.Recovery) -> Int = { kind in portions.filter { $0.recoveryState == kind }.count }
        let saved = count(.reported) + count(.repaired)
        let groups: [(Int, String)] = [
            (saved, saved == 1 ? "report saved" : "reports saved"), (count(.working), "working"),
            (count(.waiting), "awaiting start"), (count(.retryQueued), "retries queued"), (count(.blocked), "blocked"),
            (count(.interrupted), "interrupted"), (count(.stopped), "stopped"), (count(.failed), "failed"),
            (count(.unconfirmed) + count(.repairUnavailable), "need review")
        ]
        return groups.filter { $0.0 > 0 }.map { "\($0.0) \($0.1)" }.joined(separator: " · ")
    }

    /// "2 of 3 done", "Complete", "Stuck: P1 failed".
    public var summary: String {
        let uncertain = portions.filter { $0.recoveryState == .interrupted || $0.recoveryState == .unconfirmed || $0.recoveryState == .repairUnavailable }.map { "P\($0.n)" }
        if !uncertain.isEmpty { return "Review needed: " + uncertain.joined(separator: ", ") }
        if complete { return "Complete" }
        if stuck {
            let bad = portions.filter { $0.state == .failed || $0.state == .stopped }.map { "P\($0.n)" }
            return bad.isEmpty ? "Stuck" : "Stuck: " + bad.joined(separator: ", ") + " did not finish"
        }
        return "\(doneCount) of \(portions.count) done"
    }
}

extension HelpersList {
    /// The plan that goes on now, newest first; nil when none does.
    public var activePlan: WorkPlanItem? { plans.first { $0.isActive } }
}
