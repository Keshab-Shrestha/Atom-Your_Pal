import Foundation

// ADR-111: work plans. One big goal split into portions, each done by one agent. The notch shows one dot a portion; the
// Board shows the plan as a card. Pure: the runtime sends the state, this only reads it.

/// One portion of a work plan.
public struct PlanPortion: Sendable, Equatable, Identifiable {
    public enum State: String, Sendable, Equatable {
        case waiting, running, done, failed, stopped, blocked
    }

    public var n: Int
    public var agent: String
    public var name: String
    public var task: String
    /// The numbers of the portions it waits for.
    public var after: [Int]
    /// The Board task it became; nil while it waits.
    public var job: Int?
    public var state: State
    public var id: Int { n }

    public init(n: Int, agent: String, name: String, task: String, after: [Int] = [], job: Int? = nil, state: State = .waiting) {
        self.n = n
        self.agent = agent
        self.name = name
        self.task = task
        self.after = after
        self.job = job
        self.state = state
    }

    /// "Waiting for P1", "Working", "Done", ...
    public func stateText(portions: [PlanPortion]) -> String {
        switch state {
        case .waiting:
            let open = after.filter { n in portions.first { $0.n == n }?.state != .done }
            return open.isEmpty ? "Ready" : "Waits for " + open.map { "P\($0)" }.joined(separator: ", ")
        case .running: return "Working"
        case .done: return "Done"
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

    /// "2 of 3 done", "Complete", "Stuck: P1 failed".
    public var summary: String {
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
