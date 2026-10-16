// A task as the runtime reports it: its state, steps, sub-agents, tool calls and checkpoints (split out of Helpers.swift, 2026-10-16).
import Foundation

public enum JobState: String, Sendable, Equatable, CaseIterable {
    case queued, running, done, failed, stopped

    /// Stop applies only to these.
    public var isActive: Bool { self == .queued || self == .running }

    public var title: String {
        switch self {
        case .queued: "Queued"
        case .running: "Running"
        case .done: "Done"
        case .failed: "Failed"
        case .stopped: "Stopped"
        }
    }
}

/// ADR-095: a sub-agent a task's run started, as its thread lists it: name, state, what it was asked and its result.
public struct HelperSubAgent: Sendable, Equatable {
    public enum State: String, Sendable, Equatable { case started, done, failed }

    public var name: String
    public var state: State
    public var description: String
    public var result: String?

    public init(name: String, state: State, description: String = "", result: String? = nil) {
        self.name = name
        self.state = state
        self.description = description
        self.result = result
    }

    /// The state in the thread's words.
    public var stateTitle: String {
        switch state {
        case .started: "Working"
        case .done: "Done"
        case .failed: "Failed"
        }
    }

    /// The line under its name: the result once it has one, else what it was asked.
    public var detail: String? {
        if let result, !result.isEmpty { return result }
        return description.isEmpty ? nil : description
    }
}

/// B3.4: one file a task's run edited or created, and whether its edit can be undone.
public struct HelperCheckpoint: Sendable, Equatable {
    public enum Kind: String, Sendable, Equatable { case modified, created }
    public enum State: String, Sendable, Equatable { case ready, changed, undone, skipped }

    /// Relative to the folder grant.
    public var path: String
    public var kind: Kind
    public var state: State
    public var reason: String?

    public init(path: String, kind: Kind, state: State, reason: String? = nil) {
        self.path = path
        self.kind = kind
        self.state = state
        self.reason = reason
    }
}

/// B3.1: one tool call of a task's runs, as its thread lists it (oldest first).
public struct HelperToolCall: Sendable, Equatable {
    public enum State: String, Sendable, Equatable { case started, ok, error }

    public var id: String
    public var agent: String?
    public var tool: String
    public var input: String
    public var state: State
    public var result: String?
    public var at: Date
    public var durationMs: Int?

    public init(id: String, agent: String? = nil, tool: String, input: String, state: State, result: String? = nil,
                at: Date, durationMs: Int? = nil) {
        self.id = id
        self.agent = agent
        self.tool = tool
        self.input = input
        self.state = state
        self.result = result
        self.at = at
        self.durationMs = durationMs
    }

    /// "850 ms", "2.3s", "1m 5s"; nil while it has no duration.
    public var durationText: String? {
        guard let ms = durationMs, ms >= 0 else { return nil }
        if ms < 1000 { return "\(ms) ms" }
        if ms < 60_000 { return String(format: "%.1fs", Double(ms) / 1000) }
        return "\(ms / 60_000)m \(ms / 1000 % 60)s"
    }
}

public struct HelperJob: Sendable, Equatable, Identifiable {
    public var id: Int
    public var task: String
    public var state: JobState
    public var createdAt: Date?
    public var endedAt: Date?
    /// What a running job is doing, in plain words.
    public var step: String?
    /// The job hit a limit and ended with what it had.
    public var partial: Bool
    /// Present when the job has a report.
    public var title: String?
    public var summary: String?
    /// Why the job failed.
    public var error: String?
    /// The model id the job runs on, once chosen, and why in plain words ("Laya: moderate", "Pinned") (ADR-083).
    public var model: String?
    public var modelReason: String?
    /// ADR-087: the tasks it waits for, those not done yet, how many notes it has, its goal and the task that made it.
    public var blockedBy: [Int]
    public var waitingFor: [Int]
    public var comments: Int
    public var goal: String?
    public var parentId: Int?
    /// Task 3.5: the goal Pal made it part of, and whether that goal has ended with its combined report.
    public var goalId: Int?
    public var goalEnded: Bool
    /// Task 3.6: its next run continues the last one's Claude session ("Start fresh" forgets it).
    public var resumable: Bool
    /// Why a runnable task waits for Keshab (a plan to approve, an interrupted run).
    public var held: String?
    /// ADR-098 item 3: Keshab interrupted its run; it waits for his next message.
    public var interrupted: Bool
    /// Task 3.8: its first run only plans; "awaiting" (Keshab's OK) or "approved", and the plan in one line.
    public var planFirst: Bool
    public var planStatus: String?
    public var planSummary: String?
    public var awaitsApproval: Bool { state == .queued && planStatus == "awaiting" }
    /// Task 3.13: Keshab's rating ("good" or "bad"); for a Tinker task, the task it reviews.
    public var rating: String?
    public var reviews: Int?
    /// ADR-090: how many times a failure was retried by itself.
    public var autoRetries: Int
    /// ADR-095: the sub-agents its runs started (the newest).
    public var subAgents: [HelperSubAgent]
    /// ADR-098: its labels, sorted.
    public var labels: [String]
    public var isFinished: Bool { state == .done || state == .failed }
    /// ADR-094: a done task (not one of Tinker's) can become a skill.
    public var canBecomeSkill: Bool { state == .done && reviews == nil }

    public init(id: Int, task: String, state: JobState, createdAt: Date? = nil, endedAt: Date? = nil, step: String? = nil,
                partial: Bool = false, title: String? = nil, summary: String? = nil, error: String? = nil,
                model: String? = nil, modelReason: String? = nil, blockedBy: [Int] = [], waitingFor: [Int] = [],
                comments: Int = 0, goal: String? = nil, parentId: Int? = nil, goalId: Int? = nil, goalEnded: Bool = false,
                resumable: Bool = false, held: String? = nil, interrupted: Bool = false, planFirst: Bool = false, planStatus: String? = nil,
                planSummary: String? = nil, rating: String? = nil, reviews: Int? = nil, autoRetries: Int = 0,
                subAgents: [HelperSubAgent] = [], labels: [String] = []) {
        self.id = id
        self.task = task
        self.state = state
        self.createdAt = createdAt
        self.endedAt = endedAt
        self.step = step
        self.partial = partial
        self.title = title
        self.summary = summary
        self.error = error
        self.model = model
        self.modelReason = modelReason
        self.blockedBy = blockedBy
        self.waitingFor = waitingFor
        self.comments = comments
        self.goal = goal
        self.parentId = parentId
        self.goalId = goalId
        self.goalEnded = goalEnded
        self.resumable = resumable
        self.held = held
        self.interrupted = interrupted
        self.planFirst = planFirst
        self.planStatus = planStatus
        self.planSummary = planSummary
        self.rating = rating
        self.reviews = reviews
        self.autoRetries = autoRetries
        self.subAgents = subAgents
        self.labels = labels
    }

    public var hasReport: Bool { title != nil }

    /// Queued but held back by tasks not done yet.
    public var isWaiting: Bool { state == .queued && !waitingFor.isEmpty }

    /// A short name for the task in other tasks' "Waits for": its report's title, else its own words.
    public var shortTitle: String {
        let text = title ?? task
        return text.count > 48 ? String(text.prefix(47)) + "…" : text
    }

    /// The state badge's word: a done job that hit a limit says so.
    public var badge: String { state == .done && partial ? "Partial" : state.title }

    /// How far a running job is, from its step's "n of m" ("Reading 3 of 8 pages" is 3/8), for the ATOM window's
    /// line of light (ADR-084). Nil when the job is not running or its step has no count it can trust.
    public var progress: Double? {
        guard state == .running, let step else { return nil }
        return Self.progress(in: step)
    }

    /// The first "n of m" in `text` as n/m, when 0 ≤ n ≤ m and m > 0.
    public static func progress(in text: String) -> Double? {
        let words = text.split(whereSeparator: \.isWhitespace).map(String.init)
        for i in words.indices.dropFirst().dropLast() where words[i].lowercased() == "of" {
            guard let done = Int(words[i - 1]), let total = Int(words[i + 1].trimmingCharacters(in: .punctuationCharacters)),
                  total > 0, done >= 0, done <= total else { continue }
            return Double(done) / Double(total)
        }
        return nil
    }
}
