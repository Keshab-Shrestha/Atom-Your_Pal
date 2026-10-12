// ADR-098 item 6: the window's one search (chats, tasks, reports) and the labels on tasks.
import Foundation

/// One search result: what to open (a chat id, or a task id for tasks and reports), a title, a short snippet, a date.
public struct SearchHit: Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var snippet: String
    public var at: Date?

    public init(id: String, title: String, snippet: String, at: Date?) {
        self.id = id
        self.title = title
        self.snippet = snippet
        self.at = at
    }

    /// The task id of a task or report result.
    public var taskId: Int? { Int(id) }
}

/// The answer to one `search`, by kind (at most 20 of each). `query` is the query answered.
public struct SearchResults: Sendable, Equatable {
    public var query: String
    public var chats: [SearchHit]
    public var tasks: [SearchHit]
    public var reports: [SearchHit]

    public init(query: String, chats: [SearchHit] = [], tasks: [SearchHit] = [], reports: [SearchHit] = []) {
        self.query = query
        self.chats = chats
        self.tasks = tasks
        self.reports = reports
    }

    public var isEmpty: Bool { chats.isEmpty && tasks.isEmpty && reports.isEmpty }
}

public enum TaskLabels {
    /// The longest query the runtime takes.
    public static let maxQuery = 200
    public static let maxLabels = 6
    public static let maxLength = 24

    /// Every label on the given tasks, sorted, once each: the Board's filter menu.
    public static func inUse(_ jobs: [HelperJob]) -> [String] {
        Array(Set(jobs.flatMap(\.labels))).sorted()
    }

    /// The tasks with `label`, or all of them when `label` is nil.
    public static func filter(_ jobs: [HelperJob], label: String?) -> [HelperJob] {
        guard let label else { return jobs }
        return jobs.filter { $0.labels.contains(label) }
    }
}
