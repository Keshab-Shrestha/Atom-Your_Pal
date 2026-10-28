import Testing
@testable import AtomIslandCore

struct BoardViewTests {
    @Test func overviewComesBeforeFloor() {
        #expect(BoardView.allCases == [.needsYou, .overview, .floor, .columns], "what waits for Keshab comes first")
        #expect(BoardView.allCases.map(\.title) == ["Needs you", "Activity", "Studio", "Tasks"])
    }

    @Test func aStoredOverviewPageIsTheBoardsOverview() {
        #expect(BoardView(storedPage: "overview") == .overview)
        // 2026-10-15: Needs you and Issues moved into the Board; their old page names open those views.
        #expect(BoardView(storedPage: "inbox") == .needsYou && BoardView(storedPage: "issues") == .needsYou, "failed tasks are part of Needs you")
        #expect(BoardView.needsYou.title == "Needs you" && BoardView.columns.title == "Tasks")
        #expect(BoardView(storedPage: "dashboard") == nil)
        #expect(BoardView(storedPage: "floor") == nil)
    }

    @Test func theBoardViewIsAHistoryStepOnlyOnTheBoard() {
        let overview = WindowLocation(page: .agents, showsBoard: true, boardView: .overview)
        let floor = WindowLocation(page: .agents, showsBoard: true, boardView: .floor)
        #expect(overview != floor)
        #expect(WindowLocation(page: .dashboard, boardView: .overview) == WindowLocation(page: .dashboard, boardView: .floor))
        #expect(WindowLocation(page: .agents, showsBoard: false, boardView: .overview) == WindowLocation(page: .agents))
    }
}
