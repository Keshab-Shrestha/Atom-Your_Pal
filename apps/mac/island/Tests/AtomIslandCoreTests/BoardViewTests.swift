import Testing
@testable import AtomIslandCore

struct BoardViewTests {
    @Test func overviewComesBeforeFloor() {
        #expect(BoardView.allCases == [.overview, .floor, .columns])
        #expect(BoardView.allCases.map(\.title) == ["Overview", "Floor", "Columns"])
    }

    @Test func aStoredOverviewPageIsTheBoardsOverview() {
        #expect(BoardView(storedPage: "overview") == .overview)
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
