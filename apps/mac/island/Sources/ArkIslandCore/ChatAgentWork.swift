import Foundation

/// One agent ARK started from a chat, as the chat shows it (2026-11-01): what it runs now, or how it ended.
public struct ChatAgentRow: Sendable, Equatable, Identifiable {
    /// The job's id.
    public let id: Int
    public let helperId: String
    public let agent: String
    public let task: String
    public let state: JobState
    public let step: String?
    public let summary: String?
    public let error: String?
    public let startedAt: Date?
    public let endedAt: Date?
    /// How deep in the tree (2026-11-02): 0 for an agent ARK started, 1 for one that agent started, and so on.
    public var depth = 0
    /// ADR-273: the row's glyph, how many agents it started, and when it last moved when it is quiet.
    public var mark: WorkerMark = .queued
    public var workers = 0
    public var quietSince: Date?

    /// What the row says under the name: the live step while it runs, then the report's line or why it failed.
    public var detail: String? {
        if mark == .needsYou { return "Waiting for you" }
        return switch state {
        case .running: step ?? "Working"
        case .queued: "Waiting to start"
        case .done: summary
        case .failed: error ?? "Failed"
        case .stopped: "Stopped"
        }
    }

    /// ADR-273: the detail as one short line for the Workers card.
    public var line: String? { JobTree.line(detail) }
}

/// The agents of one chat, from the team list the window already keeps. Running and queued agents always show;
/// finished ones for an hour, then only the Agents page keeps them. Oldest first, in the order ARK started them.
public enum ChatAgentWork {
    public static let keepFinished: TimeInterval = 3600

    public static func rows(helpers: [Helper], chat: String?, now: Date = Date()) -> [ChatAgentRow] {
        guard let chat else { return [] }
        let all = helpers.flatMap(\.jobs)
        let workers = JobTree.workerCounts(all)
        let parents = Dictionary(all.compactMap { job in job.parentId.map { (job.id, $0) } }, uniquingKeysWith: { a, _ in a })
        let rows = helpers.flatMap { helper in
            helper.jobs.filter { $0.chatId == chat }.map { job in
                var row = ChatAgentRow(id: job.id, helperId: helper.id, agent: helper.name, task: job.title ?? job.task, state: job.state,
                                       step: job.step, summary: job.summary, error: job.error, startedAt: job.createdAt, endedAt: job.endedAt)
                row.mark = WorkerMark.of(job)
                row.workers = workers[job.id] ?? 0
                row.quietSince = job.state == .running ? job.quietSince : nil
                return row
            }
        }
        let shown = rows
            .filter { $0.state.isActive || $0.endedAt.map { now.timeIntervalSince($0) < keepFinished } == true }
            .sorted { ($0.startedAt ?? .distantPast, $0.id) < ($1.startedAt ?? .distantPast, $1.id) }
        // A tree (2026-11-02, ADR-273): each sub-agent right under the agent that started it. A parent that is not shown makes a root.
        return JobTree.ordered(shown, id: \.id, parent: { parents[$0.id] }).map { entry in
            var row = entry.item
            row.depth = entry.depth
            return row
        }
    }
}
