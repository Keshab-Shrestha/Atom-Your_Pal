import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-094 part B, after ADR-110: the Scheduled page (routines). Team tasks and wake-ups were removed with the Managers.
@Suite("Scheduled page (ADR-094)")
struct ScheduledTests {
    static let line = #"""
    {"type":"helpers","apps":[],
     "helpers":[
      {"id":"sid","name":"Sid","available":true,"app":null,"role":"researcher","jobs":[],
       "routines":[{"id":1,"task":"News","when":"Every day at 8:00 AM","nextAt":"2026-10-13T08:00:00Z","lastAt":"2026-10-12T08:00:00Z"},
                   {"id":2,"task":"Rates","when":"Every 3 hours","paused":true}]},
      {"id":"penny","name":"Penny","available":true,"app":null,"role":"financial adviser","jobs":[]},
      {"id":"tinker","name":"Tinker","available":false,"app":null,"role":"improver","jobs":[]}
     ]}
    """#.replacingOccurrences(of: "\n", with: "")

    static func date(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }

    func list() throws -> HelpersList {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { throw ProtocolError.invalidValue(event: "helpers", field: "test") }
        return list
    }

    @Test func decodesPausedRoutines() throws {
        let sid = try list().helpers[0]
        #expect(sid.routines[0].nextAt == Self.date("2026-10-13T08:00:00Z"))
        #expect(sid.routines[1].paused && sid.routines[1].nextAt == nil)
    }

    @Test func aRuntimeThatStillSendsWakeUpsAndTeamTasksIsIgnoredNotRejected() throws {
        let older = Self.line.replacingOccurrences(of: #"{"type":"helpers","apps":[],"#, with: #"{"type":"helpers","apps":[],"teamTasks":[{"id":4,"task":"x"}],"#)
            .replacingOccurrences(of: #""role":"researcher","jobs":[],"#, with: #""role":"researcher","wakeUp":{"every":"1h","when":"Every hour","nextAt":"2026-10-12T10:00:00Z"},"jobs":[],"#)
        guard case .helpers(let list) = try decodeEvent(older) else { Issue.record("not helpers"); return }
        #expect(list.helpers.count == 3)
        #expect(ScheduledPage(list: list).entries.map(\.id) == ["routine-1", "routine-2"], "no wake-up entry")
    }

    @Test func encodesTheCommands() {
        #expect(IslandCommand.routinePause(id: 2, paused: true).line == #"{"id":2,"paused":true,"type":"routine.pause"}"# + "\n")
    }

    @Test func routinesFromTheWindow() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        #expect(state.pauseRoutine(2, paused: true) == nil, "already paused")
        #expect(state.pauseRoutine(2, paused: false) == .routinePause(id: 2, paused: false))
        #expect(state.deleteAnyRoutine(1) == .routineDelete(id: 1))
        #expect(state.deleteAnyRoutine(9) == nil)
    }

    @Test func thePageSortsByNextTimePausedLast() throws {
        let page = ScheduledPage(list: try list())
        #expect(page.entries.map(\.id) == ["routine-1", "routine-2"])
        #expect(!page.isEmpty)
        #expect(ScheduledPage(list: HelpersList(helpers: [], apps: [])).isEmpty)
    }

    @Test func theTimesInWords() throws {
        let page = ScheduledPage(list: try list())
        let now = Self.date("2026-10-12T09:03:00Z")
        let news = page.entries[0], paused = page.entries[1]
        #expect(ScheduledPage.nextText(news, now: now) == "Next in 22 h")
        #expect(ScheduledPage.nextText(paused, now: now) == "Paused")
        #expect(ScheduledPage.nextText(news, now: Self.date("2026-10-13T07:30:00Z")) == "Next in 30 min")
        #expect(ScheduledPage.nextText(news, now: Self.date("2026-10-13T08:00:30Z")) == "Due now")
        #expect(ScheduledPage.lastText(news, now: now) == "Last ran 1 h ago")
        #expect(ScheduledPage.lastText(paused, now: now) == "Not run yet")
        #expect(ScheduledPage.span(90) == "1 min")
        #expect(ScheduledPage.span(86_400 + 60) == "1 day")
    }
}
