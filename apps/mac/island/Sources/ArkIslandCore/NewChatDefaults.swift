import Foundation

// Settings → Defaults (Keshab, 2026-11-02: "a section where we can select default for something and save as preference").

/// Where ⌘N and the sidebar's new chat button start a chat.
public enum NewChatPlace: String, CaseIterable, Sendable {
    /// The project chosen in the sidebar's filter, or a plain chat when none is chosen (the behaviour before Defaults).
    case selectedProject
    case plain
    /// The project of the newest chat that has one.
    case lastProject

    public var title: String {
        switch self {
        case .selectedProject: "Project in the sidebar"
        case .plain: "Plain chat"
        case .lastProject: "Last project used"
        }
    }

    /// The project a new chat goes in; nil starts a plain chat. An archived or unknown project is never used.
    public func project(filter: String?, chats: [ChatInfo], projects: [ProjectInfo]) -> String? {
        let open = Set(projects.filter { !$0.archived && !$0.missing }.map(\.id))
        switch self {
        case .plain: return nil
        case .selectedProject: return filter.flatMap { open.contains($0) ? $0 : nil }
        case .lastProject:
            return chats.filter { $0.projectId.map(open.contains) == true }
                .max { ($0.updatedAt ?? .distantPast) < ($1.updatedAt ?? .distantPast) }?.projectId
        }
    }
}

/// The page the ARK window shows when it opens.
public enum StartPage: String, CaseIterable, Sendable {
    case chat, board, dashboard
    /// The page that was open when the window last closed.
    case last

    public var title: String {
        switch self {
        case .chat: "Chat"
        case .board: "Board"
        case .dashboard: "Dashboard"
        case .last: "Last page used"
        }
    }
}

/// The thinking level Defaults offers. A new chat uses it only when its model has that level; otherwise the model's own default.
public enum DefaultEffort: String, SettingsChoice {
    case model = "", low, medium, high, xhigh, max

    public var title: String { self == .model ? "Model default" : ChatReasoning.title(rawValue) }
}

/// The Dashboard's trend range, in days.
public enum DashboardRange: Int, SettingsChoice {
    case week = 7, month = 30, quarter = 90

    public var title: String { "\(rawValue) days" }
}

extension NewChatPlace: SettingsChoice {}
extension StartPage: SettingsChoice {}
extension ChatAccessMode: SettingsChoice {}
