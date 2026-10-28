// ADR-107: Projects in the window's sidebar. A project is a named folder and its chats; the runtime sends both lists
// and the window groups the chats by `projectId`.
import Foundation

/// One project, as the runtime lists it.
public struct ProjectInfo: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    /// The folder with `~` for the home folder, for display.
    public var folderLabel: String
    /// The folder is gone or no longer allowed: the project's chats open as text only.
    public var missing: Bool
    public var archived: Bool
    public var chatCount: Int
    /// Web search in the project's chats.
    public var web: Bool
    public var agent: String?
    public var provider: String?
    public var model: String?

    public init(id: String, name: String, folderLabel: String = "", missing: Bool = false, archived: Bool = false, chatCount: Int = 0,
                web: Bool = false, agent: String? = nil, provider: String? = nil, model: String? = nil) {
        self.id = id
        self.name = name
        self.folderLabel = folderLabel
        self.missing = missing
        self.archived = archived
        self.chatCount = chatCount
        self.web = web
        self.agent = agent
        self.provider = provider
        self.model = model
    }

    /// The real folder: `folderLabel` with `~` expanded.
    public var folderPath: String { (folderLabel as NSString).expandingTildeInPath }

    /// "<Project> - <folder>", the chip over an open project chat.
    public var chipTitle: String { folderLabel.isEmpty ? name : "\(name) - \(folderLabel)" }

    /// The row's one spoken line: "<name>, project, <n> chats, expanded|collapsed".
    public func accessibilityLabel(expanded: Bool) -> String {
        "\(name), project, \(chatCount) \(chatCount == 1 ? "chat" : "chats"), \(expanded ? "expanded" : "collapsed")"
    }
}

extension ChatList {
    /// Projects are on (the runtime sent the key, even an empty one).
    public var projectsOn: Bool { projects != nil }

    /// The chats that are in no project (and in none the runtime no longer lists), newest first.
    public var plainChats: [ChatInfo] {
        let known = Set((projects ?? []).map(\.id))
        return chats.filter { !$0.archived && $0.projectId.map(known.contains) != true }.sorted { $0.pinned != $1.pinned ? $0.pinned : ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
    }

    /// A project's chats, newest first (the runtime sends them newest first; this keeps that order).
    public func chats(in projectId: String) -> [ChatInfo] {
        chats.filter { $0.projectId == projectId && !$0.archived }.sorted { $0.pinned != $1.pinned ? $0.pinned : ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
    }

    /// The projects shown in the list: the open ones; archived ones only when asked.
    public func visibleProjects(showArchived: Bool) -> [ProjectInfo] {
        (projects ?? []).filter { showArchived || !$0.archived }
    }

    public var archivedCount: Int { (projects ?? []).filter(\.archived).count }

    /// The project of the chat in use, for the chip over the chat.
    public var currentProject: ProjectInfo? {
        guard let id = currentProjectId else { return nil }
        return projects?.first { $0.id == id }
    }
}

/// How many of a project's chats the sidebar shows before "Show more".
public enum ProjectList {
    public static let firstChats = 10

    public static func shown(_ chats: [ChatInfo], all: Bool) -> [ChatInfo] {
        all ? chats : Array(chats.prefix(firstChats))
    }

    /// The name a new project starts with: the folder's name.
    public static func suggestedName(forFolder path: String) -> String {
        String((path as NSString).lastPathComponent.prefix(60))
    }

    /// The confirmation's question, with the folder as `~/...`.
    public static func grantQuestion(folderLabel: String) -> String {
        "Let ATOM read files in \(folderLabel) in this project's chats, and let its agent edit them (with your approval and undo)?"
    }

    /// `/Users/me/Developer/haat` as `~/Developer/haat`.
    public static func label(forPath path: String, home: String = NSHomeDirectory()) -> String {
        if path == home { return "~" }
        return path.hasPrefix(home + "/") ? "~" + path.dropFirst(home.count) : path
    }

    /// A name the runtime accepts: 1 to 60 characters on one line.
    public static func isValidName(_ name: String) -> Bool {
        let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return !t.isEmpty && !t.contains(where: \.isNewline)
    }
}
