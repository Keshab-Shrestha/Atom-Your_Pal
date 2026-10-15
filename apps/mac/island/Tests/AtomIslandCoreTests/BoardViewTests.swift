import Testing
@testable import AtomIslandCore

struct BoardViewTests {
    @Test func overviewComesBeforeFloor() {
        #expect(BoardView.allCases == [.overview, .floor, .columns, .needsYou, .issues])
        #expect(BoardView.allCases.map(\.title) == ["Overview", "Floor", "Columns", "Needs you", "Issues"])
    }

    @Test func aStoredOverviewPageIsTheBoardsOverview() {
        #expect(BoardView(storedPage: "overview") == .overview)
        // 2026-10-15: Needs you and Issues moved into the Board; their old page names open those views.
        #expect(BoardView(storedPage: "inbox") == .needsYou && BoardView(storedPage: "issues") == .issues)
        #expect(BoardView.needsYou.title == "Needs you" && BoardView.issues.title == "Issues" && BoardView.columns.title == "Columns")
        #expect(BoardView.allCases == [.overview, .floor, .columns, .needsYou, .issues])
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
