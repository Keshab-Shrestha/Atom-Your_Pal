// ADR-096: Back in the ARK window: where Keshab has been, as plain values, so the window's logic is testable.

/// ADR-089: the ARK window's pages: the conversation, the board and the team, and Settings.
public enum WindowPage: Equatable, Sendable {
    /// 2026-11-06: Scheduled is part of Automations (`workflows`), Panels part of Apps.
    case dashboard, chat, workflows, apps, agents, plugins, brain, settings, you
}

/// The Board's views, in the order of its switch: what waits for Keshab first. Overview, Needs you and Issues were sidebar
/// pages; they live here now (2026-10-15 for the last two, which freed room in the sidebar for Projects and Chats). Failed
/// tasks are part of Needs you: they wait for him (ADR-116).
public enum BoardView: String, CaseIterable, Sendable {
    case needsYou, overview, floor, columns, team

    /// The name the switch shows.
    public var title: String {
        switch self {
        case .needsYou: "Needs you"
        case .floor: "Studio"
        case .columns: "Flow"
        case .overview: "Activity"
        case .team: "Team"
        }
    }

    /// ADR-256: Needs you and Tasks are one view, the Flow: four lanes on a wide pane. `needsYou` stays a case so a saved place and
    /// "open what needs me" still land there.
    public var isFlow: Bool { self == .needsYou || self == .columns }

    /// Reads a stored page name: the old "overview", "inbox" (Needs you) and "issues" (also Needs you) pages are Board views. Other names
    /// are not Board views.
    public init?(storedPage: String) {
        switch storedPage {
        case "overview": self = .overview
        case "inbox": self = .needsYou
        case "issues": self = .needsYou // failed tasks are part of Needs you
        default: return nil
        }
    }
}

/// Where Back goes (Keshab, 2026-11-06: "take it back to home or chats", not into the Board tab left before). Inside a page, Back
/// steps out to that page (an agent or a task to the Board, an open app to the Apps list, a Settings page to Settings). From any
/// page it goes Home; from Home, to Chats. Pure.
public enum BackStep: Equatable, Sendable {
    case toBoard, closeApp, toSettings, to(WindowPage)

    public static func from(page: WindowPage, insideAgents: Bool, appOpen: Bool, settingsSubpage: Bool) -> BackStep {
        if page == .agents && insideAgents { return .toBoard }
        if page == .apps && appOpen { return .closeApp }
        if page == .settings && settingsSubpage { return .toSettings }
        return page == .dashboard ? .to(.chat) : .to(.dashboard)
    }
}
