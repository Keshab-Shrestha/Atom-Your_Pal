import Testing
@testable import ArkIslandCore

struct BoardViewTests {
    @Test func needsYouComesFirst() {
        #expect(BoardView.allCases == [.needsYou, .floor, .columns, .team], "what waits for Keshab comes first; Activity is on Home (2026-11-06)")
        #expect(BoardView.allCases.map(\.title) == ["Needs you", "Studio", "Flow", "Team"])
    }

    /// ADR-256: Needs you and Tasks are one view, the Flow.
    @Test func needsYouAndTasksAreTheFlow() {
        #expect(BoardView.allCases.filter(\.isFlow) == [.needsYou, .columns])
    }

    @Test func aStoredOverviewPageOpensTheFlow() {
        #expect(BoardView(storedPage: "overview") == .columns, "Activity moved to Home; its old saved name opens the Flow")
        // 2026-10-15: Needs you and Issues moved into the Board; their old page names open those views.
        #expect(BoardView(storedPage: "inbox") == .needsYou && BoardView(storedPage: "issues") == .needsYou, "failed tasks are part of Needs you")
        #expect(BoardView.needsYou.title == "Needs you" && BoardView.columns.title == "Flow")
        #expect(BoardView(storedPage: "dashboard") == nil)
        #expect(BoardView(storedPage: "floor") == nil)
    }
}
