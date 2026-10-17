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

/// One row of the search results, in the order the window draws them, for the keyboard (upgrades.md C1).
public struct SearchEntry: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable, Equatable { case chat, task, report, other(SearchKind), settings }

    public var kind: Kind
    public var hit: SearchHit?
    public var page: SettingsPage?

    public init(kind: Kind, hit: SearchHit? = nil, page: SettingsPage? = nil) {
        self.kind = kind
        self.hit = hit
        self.page = page
    }

    /// Unique in the whole list, whatever the group.
    public var id: String {
        switch kind {
        case .chat: "chat:\(hit?.id ?? "")"
        case .task: "task:\(hit?.id ?? "")"
        case .report: "report:\(hit?.id ?? "")"
        case .other(let k): "\(k.rawValue):\(hit?.id ?? "")"
        case .settings: "settings:\(page?.rawValue ?? "")"
        }
    }
}

/// A heading and its rows.
public struct SearchSection: Sendable, Equatable, Identifiable {
    public var title: String
    public var entries: [SearchEntry]
    public var id: String { title }

    public init(title: String, entries: [SearchEntry]) {
        self.title = title
        self.entries = entries
    }
}

extension SearchResults {
    /// The groups that have rows, in the order the window shows them: chats, tasks, reports, the other places, Settings pages.
    public var sections: [SearchSection] {
        var out: [SearchSection] = []
        func add(_ title: String, _ entries: [SearchEntry]) { if !entries.isEmpty { out.append(SearchSection(title: title, entries: entries)) } }
        add("Chats", chats.map { SearchEntry(kind: .chat, hit: $0) })
        add("Tasks", tasks.map { SearchEntry(kind: .task, hit: $0) })
        add("Reports", reports.map { SearchEntry(kind: .report, hit: $0) })
        for kind in SearchKind.allCases { add(kind.title, hits(kind).map { SearchEntry(kind: .other(kind), hit: $0) }) }
        add("Settings", settingsPages().map { SearchEntry(kind: .settings, page: $0) })
        return out
    }

    /// Every row, top to bottom.
    public var entries: [SearchEntry] { sections.flatMap(\.entries) }
}

/// Which row the arrow keys have chosen. Nothing is chosen until a key is pressed; Return then opens that row.
public struct SearchCursor: Sendable, Equatable {
    public private(set) var index: Int?

    public init() {}

    /// ↓ is +1 and ↑ is -1. From nothing, ↓ chooses the first row and ↑ the last. At the ends it stays (it does not wrap).
    public mutating func move(_ delta: Int, count: Int) {
        guard count > 0 else { index = nil; return }
        guard let current = index else {
            index = delta >= 0 ? 0 : count - 1
            return
        }
        index = min(count - 1, max(0, current + delta))
    }

    /// The row to open, if the chosen one is still in the list.
    public func entry(in entries: [SearchEntry]) -> SearchEntry? {
        guard let index, entries.indices.contains(index) else { return nil }
        return entries[index]
    }

    public mutating func reset() { index = nil }
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
