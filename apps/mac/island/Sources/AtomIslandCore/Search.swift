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

/// The other places "search everything" looks in (upgrades.md C1). The runtime sends one group for each; an older runtime
/// sends none. `id` of a hit: a Second brain note id (pages), a project id, a helper id (agents), a skill name, a routine id;
/// facts and notes are Memory entries.
public enum SearchKind: String, CaseIterable, Sendable {
    case pages, facts, notes, projects, agents, skills, routines

    /// The heading over the group.
    public var title: String {
        switch self {
        case .pages: "Second brain"
        case .facts: "Remembered"
        case .notes: "Conversation notes"
        case .projects: "Projects"
        case .agents: "Agents"
        case .skills: "Skills"
        case .routines: "Routines"
        }
    }
}

/// The answer to one `search`, by kind (at most 20 of each of the first three, 8 of the others). `query` is the query answered.
public struct SearchResults: Sendable, Equatable {
    public var query: String
    public var chats: [SearchHit]
    public var tasks: [SearchHit]
    public var reports: [SearchHit]
    public var groups: [SearchKind: [SearchHit]]

    public init(query: String, chats: [SearchHit] = [], tasks: [SearchHit] = [], reports: [SearchHit] = [], groups: [SearchKind: [SearchHit]] = [:]) {
        self.query = query
        self.chats = chats
        self.tasks = tasks
        self.reports = reports
        self.groups = groups
    }

    public func hits(_ kind: SearchKind) -> [SearchHit] { groups[kind] ?? [] }

    /// Settings pages whose name has the words (case and width ignored). Searched on this Mac: the runtime has no list of them.
    public func settingsPages() -> [SettingsPage] {
        SearchResults.settingsPages(matching: query)
    }

    public static func settingsPages(matching query: String) -> [SettingsPage] {
        let words = fold(query)
        guard !words.isEmpty else { return [] }
        return SettingsPage.allCases.filter { fold($0.rawValue).contains(words) }
    }

    /// Lower case with compatible forms joined, so "ＡＩ" finds "AI model".
    static func fold(_ text: String) -> String {
        text.precomposedStringWithCompatibilityMapping.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var isEmpty: Bool {
        chats.isEmpty && tasks.isEmpty && reports.isEmpty && groups.values.allSatisfy(\.isEmpty) && settingsPages().isEmpty
    }
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
