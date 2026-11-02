import Testing
@testable import ArkIslandCore

/// 2026-10-16: going up with a page's own "‹" and then the top bar's Back looped between two pages. Since 2026-10-31
/// an agent's soul is not a step of its own, so three plain steps stand in for Board → Jobs → Soul.
@Suite("Window history: going up with a page's own back button")
struct WindowHistoryUpTests {
    let board = WindowLocation(page: .agents, showsBoard: true)
    let jobs = WindowLocation(page: .agents)
    let soul = WindowLocation(page: .settings)

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

/// 2026-10-31 (Keshab): the Board with an agent open, then Settings, then Back reopened the agent.
@Suite("Window history: Back does not reopen what was open inside the team page")
struct WindowHistoryAgentTests {
    @Test func backAfterSettingsLandsOnTheBoardWithNoAgentOpen() throws {
        var helpers = HelpersState()
        helpers.apply(try decodeEvent(HelperSoulTests.line))
        helpers.selectHelper("sid")
        helpers.openSoul()
        #expect(!helpers.showsBoard && helpers.isSoulOpen)
        let onAgent = WindowLocation(page: .agents, helpers: helpers, allAgents: true)
        var history = WindowHistory()
        history.recordMove(from: onAgent, up: false) // the agent's page → Settings
        let back = history.back(where: { $0 != WindowLocation(page: .settings) })
        let target = try #require(back)
        helpers.show(target)
        #expect(target.page == .agents && target.allAgents, "the page and the All agents switch come back")
        #expect(helpers.showsBoard && !helpers.isSoulOpen && helpers.openJobId == nil && !helpers.isCreatingAgent)
    }

    @Test func whichAgentOrTaskIsOpenIsNotAStep() throws {
        var helpers = HelpersState()
        helpers.apply(try decodeEvent(HelperSoulTests.line))
        helpers.selectHelper("sid")
        let sid = WindowLocation(page: .agents, helpers: helpers, allAgents: false)
        helpers.selectHelper("penny")
        helpers.openSoul()
        #expect(WindowLocation(page: .agents, helpers: helpers, allAgents: false) == sid)
    }
}
