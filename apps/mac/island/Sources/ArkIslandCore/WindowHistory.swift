// ADR-096: Back in the ARK window: where Keshab has been, as plain values, so the window's logic is testable.

/// ADR-089: the ARK window's pages: the conversation, the board and the team, and Settings.
public enum WindowPage: Equatable, Sendable {
    case dashboard, chat, scheduled, workflows, agents, plugins, brain, settings
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
        case .columns: "Tasks"
        case .overview: "Activity"
        case .team: "Team"
        }
    }

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

/// One step of the window's history: the sidebar page and, on the team page, whether the Board or an agent was
/// shown, the Board's view and whether All agents was open. What was open inside the page (which agent, a task, a
/// soul, the new-agent form) is not kept: Back returns to the Board, never into an agent Keshab already left
/// (2026-10-31: Board with an agent open, Settings, Back reopened the agent).
public struct WindowLocation: Equatable, Sendable {
    public var page: WindowPage
    /// The Board was shown, not an agent's page. Keeps "Board, then an agent" two steps; both return to the Board.
    public var showsBoard = false
    public var boardView = BoardView.floor
    public var allAgents = false

    public init(page: WindowPage, showsBoard: Bool = false, boardView: BoardView = .floor, allAgents: Bool = false) {
        self.page = page
        guard page == .agents else { return }
        self.showsBoard = showsBoard
        self.boardView = showsBoard ? boardView : .floor
        self.allAgents = allAgents
    }

    public init(page: WindowPage, helpers: HelpersState, allAgents: Bool, boardView: BoardView = .floor) {
        self.init(page: page, showsBoard: helpers.showsBoard, boardView: boardView, allAgents: allAgents)
    }
}

/// The steps Back returns to, newest last: at most 30, never the same step twice in a row.
public struct WindowHistory: Equatable, Sendable {
    public static let limit = 30
    public private(set) var steps: [WindowLocation] = []

    public init() {}

    public var canGoBack: Bool { !steps.isEmpty }

    public mutating func push(_ location: WindowLocation) {
        guard steps.last != location else { return }
        steps.append(location)
        if steps.count > Self.limit { steps.removeFirst(steps.count - Self.limit) }
    }

    /// A move away from `last`: it becomes a step Back returns to, unless the move went up a level with a page's own "‹" button
    /// (Soul → Jobs, a report → Board). Then the page left is not a step to come back to; without this, the top bar's Back led
    /// into the Soul page and its "‹" led out again, in a loop (found by Keshab, 2026-10-16).
    public mutating func recordMove(from last: WindowLocation, up: Bool) {
        if !up { push(last) }
    }

    /// The newest step that `isUsable` accepts; the steps after it, and it, leave the history.
    public mutating func back(where isUsable: (WindowLocation) -> Bool) -> WindowLocation? {
        while let last = steps.popLast() {
            if isUsable(last) { return last }
        }
        return nil
    }
}
