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

/// ADR-090: the office floor's plan: where each pal is (its desk while it works, else the lounge), what it is doing (the animation it
/// plays and a line in its bubble), and the hand-offs in flight (an envelope from one desk to another). Pure.
public struct OfficePlan: Sendable, Equatable {
    public enum Spot: Sendable, Equatable { case desk(Int), lounge(Int) }

    public struct Seat: Sendable, Equatable, Identifiable {
        public var id: String { helperId }
        public var helperId: String
        public var name: String
        /// Its own desk, kept whether or not it sits at it.
        public var desk: Int
        public var spot: Spot
        public var animation: String
        /// What its bubble says: a step, "Waiting for your OK", why it is held or what failed.
        public var bubble: String?
        /// The task to open when it is clicked.
        public var taskId: Int?
        /// Amber (needs you) or red (failed) next to it.
        public var flag: Flag?
    }

    public enum Flag: Sendable, Equatable { case needsYou, failed }

    public struct Envelope: Sendable, Equatable, Identifiable {
        public var id: Int { taskId }
        public var from: String
        public var to: String
        public var taskId: Int
    }

    public var seats: [Seat]
    public var envelopes: [Envelope]

    /// How long after a goal ends its workers celebrate.
    public static let celebration: TimeInterval = 60

    public init(list: HelpersList, now: Date = Date()) {
        let team = list.helpers.filter { $0.available || !$0.jobs.isEmpty }
        var lounge = 0
        seats = team.enumerated().map { index, h in
            let running = h.jobs.first { $0.state == .running }
            let awaiting = h.jobs.first { $0.awaitsApproval }
            let held = h.jobs.first { $0.held != nil && !$0.awaitsApproval }
            let failed = h.jobs.first { $0.state == .failed }
            let celebrating = h.jobs.contains { $0.goalEnded && $0.state == .done && ($0.endedAt.map { now.timeIntervalSince($0) < Self.celebration } ?? false) }
            // Only a worker at work sits at its PC; everyone else is in the lounge.
            var seat = Seat(helperId: h.id, name: h.name, desk: index, spot: .desk(index), animation: "idle", bubble: nil, taskId: nil, flag: nil)
            if let running {
                seat.animation = "working"
                seat.bubble = running.step ?? "Working"
                seat.taskId = running.id
                return seat
            }
            seat.spot = .lounge(lounge)
            lounge += 1
            if let awaiting {
                seat.animation = "curious"
                seat.bubble = "Waiting for your OK"
                seat.taskId = awaiting.id
                seat.flag = .needsYou
            } else if let held {
                seat.animation = "bored"
                seat.bubble = held.held
                seat.taskId = held.id
                seat.flag = .needsYou
            } else if celebrating {
                seat.animation = "celebrate"
            } else if let failed, h.jobs.first?.id == failed.id {
                seat.animation = "sad"
                seat.taskId = failed.id
                seat.flag = .failed
            }
            return seat
        }
        // A sub-task not finished yet: its envelope travels from the worker that handed it off to the one doing it.
        let byJob = Dictionary(list.helpers.flatMap { h in h.jobs.map { ($0.id, h.id) } }, uniquingKeysWith: { a, _ in a })
        envelopes = list.helpers.flatMap { h in
            h.jobs.compactMap { job -> Envelope? in
                guard let parent = job.parentId, let from = byJob[parent], job.state == .queued || job.state == .running, from != h.id else { return nil }
                return Envelope(from: from, to: h.id, taskId: job.id)
            }
        }
    }
}
