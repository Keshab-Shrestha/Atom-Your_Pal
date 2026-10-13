// ADR-096: Back in the ATOM window: where Keshab has been, as plain values, so the window's logic is testable.

/// ADR-089: the ATOM window's pages: the conversation, the board and the team, and Settings.
public enum WindowPage: Equatable, Sendable {
    case dashboard, chat, inbox, issues, scheduled, agents, plugins, settings
}

/// The Board's three views, in the order of its switch. Overview was a sidebar page; it now lives here, before Floor.
public enum BoardView: String, CaseIterable, Sendable {
    case overview, floor, columns

    /// The name the switch shows.
    public var title: String { rawValue.capitalized }

    /// Reads a stored page name: the old "overview" page is the Board's Overview view. Other names are not Board views.
    public init?(storedPage: String) {
        guard let view = BoardView(rawValue: storedPage), view == .overview else { return nil }
        self = view
    }
}

/// One step of the window's history: the sidebar page and, on the team page, what is open in it. Other pages keep
/// only the page, so a change on the team page that Keshab cannot see is not a step.
public struct WindowLocation: Equatable, Sendable {
    public var page: WindowPage
    public var helperId: String?
    public var managerId: String?
    public var showsBoard = false
    public var boardView = BoardView.floor
    public var jobId: Int?
    public var soulOpen = false
    public var creatingAgent = false
    public var creatingManager = false
    public var allAgents = false

    public init(page: WindowPage, helperId: String? = nil, managerId: String? = nil, showsBoard: Bool = false, boardView: BoardView = .floor, jobId: Int? = nil,
                soulOpen: Bool = false, creatingAgent: Bool = false, creatingManager: Bool = false, allAgents: Bool = false) {
        self.page = page
        guard page == .agents else { return }
        self.helperId = helperId
        self.managerId = managerId
        self.showsBoard = showsBoard
        self.boardView = showsBoard ? boardView : .floor
        self.jobId = jobId
        self.soulOpen = soulOpen
        self.creatingAgent = creatingAgent
        self.creatingManager = creatingManager
        self.allAgents = allAgents
    }

    public init(page: WindowPage, helpers: HelpersState, allAgents: Bool, boardView: BoardView = .floor) {
        self.init(page: page, helperId: helpers.selectedHelperId, managerId: helpers.selectedManagerId, showsBoard: helpers.showsBoard, boardView: boardView,
                  jobId: helpers.openJobId, soulOpen: helpers.isSoulOpen, creatingAgent: helpers.isCreatingAgent,
                  creatingManager: helpers.isCreatingManager, allAgents: allAgents)
    }

    /// What this step shows still exists: the task, the Manager or the agent on screen (in the window's order).
    public func isValid(in list: HelpersList?) -> Bool {
        guard page == .agents, !creatingAgent, !creatingManager else { return true }
        if let jobId { return list?.item(jobId) != nil }
        if let managerId { return list?.managers.contains { $0.id == managerId } == true }
        if showsBoard { return true }
        guard let helperId else { return true }
        return list?.helpers.contains { $0.id == helperId } == true
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

    /// The newest step that `isUsable` accepts; the steps after it, and it, leave the history.
    public mutating func back(where isUsable: (WindowLocation) -> Bool) -> WindowLocation? {
        while let last = steps.popLast() {
            if isUsable(last) { return last }
        }
        return nil
    }
}
