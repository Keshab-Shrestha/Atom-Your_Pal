import Foundation

/// ADR-090: the Overview page's numbers, from the helpers list: who works on what, the goals and how far they are,
/// what came in, and the board's counts. Pure.
public struct TeamOverview: Sendable, Equatable {
    public struct Goal: Sendable, Equatable, Identifiable {
        public var id: Int
        public var text: String
        public var done: Int
        public var total: Int
        public var failed: Int
        /// Every task has ended and the combined report is written.
        public var ended: Bool
        public var fraction: Double { total == 0 ? 0 : Double(done) / Double(total) }
    }

    /// Tasks running now, longest-running first.
    public var atWork: [BoardItem]
    /// Goals with a task in the list, the unfinished first, then the newest.
    public var goals: [Goal]
    /// Finished tasks, newest first, at most `recentLimit`.
    public var recent: [BoardItem]
    public var running: Int
    public var toDo: Int
    public var needsYou: Int
    /// Tasks that ended today (local time), done or not.
    public var doneToday: Int

    public static let recentLimit = 6

    public init(list: HelpersList, now: Date = Date(), calendar: Calendar = .current) {
        let items = list.helpers.flatMap { h in h.jobs.map { BoardItem(helperId: h.id, helperName: h.name, job: $0) } }
        atWork = items.filter { $0.job.state == .running }.sorted { ($0.job.createdAt ?? now) < ($1.job.createdAt ?? now) }
        recent = Array(items.filter { $0.job.state == .done }.sorted { ($0.job.endedAt ?? .distantPast) > ($1.job.endedAt ?? .distantPast) }.prefix(Self.recentLimit))
        running = atWork.count
        toDo = items.filter { BoardColumn.of($0.job) == .toDo }.count
        needsYou = items.filter { BoardColumn.of($0.job) == .needsYou }.count
        doneToday = items.filter { item in item.job.endedAt.map { calendar.isDate($0, inSameDayAs: now) } ?? false }.count
        var byGoal: [Int: Goal] = [:]
        for item in items {
            guard let id = item.job.goalId else { continue }
            var goal = byGoal[id] ?? Goal(id: id, text: item.job.goal ?? "Goal \(id)", done: 0, total: 0, failed: 0, ended: true)
            if let text = item.job.goal, !text.isEmpty { goal.text = text } // any task that carries the goal's name
            goal.total += 1
            if item.job.state == .done { goal.done += 1 }
            if item.job.state == .failed { goal.failed += 1 }
            goal.ended = goal.ended && item.job.goalEnded
            byGoal[id] = goal
        }
        goals = byGoal.values.sorted { a, b in a.ended != b.ended ? !a.ended : a.id > b.id }
    }
}

/// ADR-090: one thing waiting on Keshab, with what it is about.
public struct NeedsYouItem: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable, Equatable {
        /// A plan-first task's plan, to approve or reject.
        case plan
        /// Tinker's proposed change to a worker's soul.
        case proposal
        /// A runnable task held by a budget or the plan's limit.
        case held
        /// A task that failed.
        case failed
    }

    public var id: String
    public var kind: Kind
    public var helperId: String
    public var helperName: String
    public var title: String
    public var detail: String
    public var jobId: Int?
    public var proposalId: Int?

    /// Everything waiting, in the order it is best answered: plans, proposals, held tasks, failures (newest first).
    public static func all(in list: HelpersList) -> [NeedsYouItem] {
        var plans: [NeedsYouItem] = [], proposals: [NeedsYouItem] = [], held: [NeedsYouItem] = [], failed: [NeedsYouItem] = []
        for h in list.helpers {
            for p in h.proposals where p.state == "pending" {
                proposals.append(NeedsYouItem(id: "proposal-\(p.id)", kind: .proposal, helperId: h.id, helperName: h.name,
                                              title: "\(p.fieldTitle): \(p.text)", detail: p.reason, jobId: nil, proposalId: p.id))
            }
            for j in h.jobs.sorted(by: { $0.id > $1.id }) {
                if j.awaitsApproval {
                    plans.append(NeedsYouItem(id: "plan-\(j.id)", kind: .plan, helperId: h.id, helperName: h.name, title: j.shortTitle,
                                              detail: j.planSummary ?? "A plan waits for your OK.", jobId: j.id))
                } else if let reason = j.held {
                    held.append(NeedsYouItem(id: "held-\(j.id)", kind: .held, helperId: h.id, helperName: h.name, title: j.shortTitle, detail: reason, jobId: j.id))
                } else if j.state == .failed {
                    failed.append(NeedsYouItem(id: "failed-\(j.id)", kind: .failed, helperId: h.id, helperName: h.name, title: j.shortTitle,
                                               detail: j.error ?? "It failed.", jobId: j.id))
                }
            }
        }
        return plans + proposals + held + failed.sorted { ($0.jobId ?? 0) > ($1.jobId ?? 0) }
    }
}

/// ADR-090: the Issues page: tasks that failed or were stopped by a limit, newest first.
public enum TeamIssues {
    public static func all(in list: HelpersList) -> [BoardItem] {
        list.helpers.flatMap { h in h.jobs.map { BoardItem(helperId: h.id, helperName: h.name, job: $0) } }
            .filter { $0.job.state == .failed }
            .sorted { $0.id > $1.id }
    }
}
