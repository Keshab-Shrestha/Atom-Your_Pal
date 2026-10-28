import Testing
@testable import AtomIslandCore

/// 2026-10-16: Board → an agent → its Soul, then the Soul page's own "‹" and the top bar's Back looped between the two pages.
@Suite("Window history: going up with a page's own back button")
struct WindowHistoryUpTests {
    let board = WindowLocation(page: .agents, showsBoard: true)
    let jobs = WindowLocation(page: .agents, helperId: "sid")
    let soul = WindowLocation(page: .agents, helperId: "sid", soulOpen: true)

    /// What the model does on every location change, and what its Back does.
    func play(upFromSoul: Bool) -> [WindowLocation?] {
        var history = WindowHistory()
        history.recordMove(from: board, up: false) // Board → the agent's Jobs page
        history.recordMove(from: jobs, up: false) // Jobs → Soul
        history.recordMove(from: soul, up: upFromSoul) // Soul → Jobs, by the page's "‹" (or by the top bar)
        var current = jobs
        var visited: [WindowLocation?] = []
        for _ in 0..<3 { // press the top bar's Back three times
            let target = history.back(where: { $0 != current })
            visited.append(target)
            if let target { current = target }
        }
        return visited
    }

    @Test func theSoulPagesOwnBackDoesNotMakeTheSoulAStepBackReturnsTo() {
        let visited = play(upFromSoul: true)
        #expect(visited.first == board, "Back from Jobs goes to the Board, not into the Soul page again")
        #expect(!visited.contains(soul))
    }

    @Test func aMoveNotMadeWithAnUpButtonStillCanBeGoneBackTo() {
        #expect(play(upFromSoul: false).first == soul, "Back after an ordinary move returns to where you were")
    }

    @Test func historyNeverStoresTheSamePageTwiceInARow() {
        var history = WindowHistory()
        history.recordMove(from: board, up: false)
        history.recordMove(from: board, up: false)
        #expect(history.steps == [board])
    }
}
