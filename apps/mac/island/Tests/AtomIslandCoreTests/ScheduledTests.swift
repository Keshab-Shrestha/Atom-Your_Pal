import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-094 part B: team tasks, wake-ups and the Scheduled page.
@Suite("Scheduled and team tasks (ADR-094)")
struct ScheduledTests {
    static let line = #"""
    {"type":"helpers","apps":[],"teamTasks":[{"id":4,"task":"Compare note apps","createdAt":"2026-10-12T00:00:00Z"},{"id":2,"task":"Find sources","role":"researcher","createdAt":"2026-10-11T23:00:00Z"},{"id":"bad","task":"x"}],
     "helpers":[
      {"id":"sid","name":"Sid","available":true,"app":null,"role":"researcher","jobs":[],
       "routines":[{"id":1,"task":"News","when":"Every day at 8:00 AM","nextAt":"2026-10-13T08:00:00Z","lastAt":"2026-10-12T08:00:00Z"},
                   {"id":2,"task":"Rates","when":"Every 3 hours","paused":true}],
       "wakeUp":{"every":"1h","when":"Every hour","nextAt":"2026-10-12T10:00:00Z","lastAt":"2026-10-12T09:00:00Z"}},
      {"id":"penny","name":"Penny","available":true,"app":null,"role":"financial adviser","jobs":[],"wakeUp":{"every":"15m","when":"Every 15 minutes","nextAt":"2026-10-12T09:15:00Z"}},
      {"id":"kame","name":"Kame","available":true,"app":null,"role":"coder","jobs":[],"wakeUp":{"every":"9h"}},
      {"id":"tinker","name":"Tinker","available":false,"app":null,"role":"improver","jobs":[]}
     ]}
    """#.replacingOccurrences(of: "\n", with: "")

    static func date(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }

    func list() throws -> HelpersList {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { throw ProtocolError.invalidValue(event: "helpers", field: "test") }
        return list
    }

    @Test func decodesWakeUpsTeamTasksAndPausedRoutines() throws {
        let list = try list()
        #expect(list.teamTasks.map(\.id) == [4, 2], "a malformed entry is left out")
        #expect(list.teamTasks[1].role == "researcher")
        #expect(list.teamTasks[0].roleTitle == "Anyone")
        let sid = list.helpers[0]
        #expect(sid.wakeUp == HelperWakeUp(every: "1h", when: "Every hour", lastAt: Self.date("2026-10-12T09:00:00Z"), nextAt: Self.date("2026-10-12T10:00:00Z")))
        #expect(sid.routines[0].nextAt == Self.date("2026-10-13T08:00:00Z"))
        #expect(sid.routines[1].paused && sid.routines[1].nextAt == nil)
        #expect(list.helpers[2].wakeUp == nil, "malformed: off")
        #expect(list.teamRoles == ["coder", "financial adviser", "researcher"], "Tinker's role is not offered")
    }

    @Test func encodesTheCommands() {
        #expect(IslandCommand.teamAdd(task: "x", role: nil).line == #"{"task":"x","type":"team.add"}"# + "\n")
        #expect(IslandCommand.teamAdd(task: "x", role: "coder").line == #"{"role":"coder","task":"x","type":"team.add"}"# + "\n")
        #expect(IslandCommand.teamDelete(id: 3).line == #"{"id":3,"type":"team.delete"}"# + "\n")
        #expect(IslandCommand.routinePause(id: 2, paused: true).line == #"{"id":2,"paused":true,"type":"routine.pause"}"# + "\n")
        #expect(IslandCommand.helperWakeUp(helper: "sid", every: "4h").line == #"{"every":"4h","helper":"sid","type":"helper.wakeUp"}"# + "\n")
        #expect(IslandCommand.helperWakeUpPause(helper: "sid", paused: false).line == #"{"helper":"sid","paused":false,"type":"helper.wakeUp.pause"}"# + "\n")
    }

    @Test func theTaskFieldPostsToTheTeam() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        state.selectHelper("sid")
        state.setPostTo("astronaut")
        #expect(state.postTo == nil, "a role no worker has is ignored")
        state.setPostTo("coder")
        #expect(state.addJob("  Fix the build ") == .teamAdd(task: "Fix the build", role: "coder"))
        state.setPostTo("")
        #expect(state.addJob("Anything") == .teamAdd(task: "Anything", role: nil))
        state.selectHelper("penny")
        #expect(state.postTo == nil, "another worker: back to that worker")
        #expect(state.addJob("Rates") == .jobAdd(helper: "penny", task: "Rates", blockedBy: []))
    }

    @Test func wakeUpsRoutinesAndTeamTasksFromTheWindow() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        #expect(state.setWakeUp("sid", every: "1h") == nil, "unchanged")
        #expect(state.setWakeUp("sid", every: "4h") == .helperWakeUp(helper: "sid", every: "4h"))
        #expect(state.setWakeUp("sid", every: "off") == .helperWakeUp(helper: "sid", every: "off"))
        #expect(state.setWakeUp("sid", every: "2h") == nil)
        #expect(state.setWakeUp("tinker", every: "1h") == nil, "Tinker takes no tasks")
        #expect(state.pauseWakeUp("sid", paused: true) == .helperWakeUpPause(helper: "sid", paused: true))
        #expect(state.pauseWakeUp("tinker", paused: true) == nil)
        #expect(state.pauseRoutine(2, paused: true) == nil, "already paused")
        #expect(state.pauseRoutine(2, paused: false) == .routinePause(id: 2, paused: false))
        #expect(state.deleteAnyRoutine(1) == .routineDelete(id: 1))
        #expect(state.deleteAnyRoutine(9) == nil)
        #expect(state.deleteTeamTask(4) == .teamDelete(id: 4))
        #expect(state.deleteTeamTask(5) == nil)
    }

    @Test func thePageSortsByNextTimePausedLast() throws {
        let page = ScheduledPage(list: try list())
        #expect(page.entries.map(\.id) == ["wake-penny", "wake-sid", "routine-1", "routine-2"])
        #expect(page.teamTasks.map(\.id) == [2, 4], "oldest first")
        #expect(!page.isEmpty)
        #expect(ScheduledPage(list: HelpersList(helpers: [], apps: [])).isEmpty)
    }

    @Test func theTimesInWords() throws {
        let page = ScheduledPage(list: try list())
        let now = Self.date("2026-10-12T09:03:00Z")
        let penny = page.entries[0], sid = page.entries[1], paused = page.entries[3], news = page.entries[2]
        #expect(ScheduledPage.nextText(penny, now: now) == "Next in 12 min")
        #expect(ScheduledPage.nextText(sid, now: now) == "Next in 57 min")
        #expect(ScheduledPage.nextText(news, now: now) == "Next in 22 h")
        #expect(ScheduledPage.nextText(paused, now: now) == "Paused")
        #expect(ScheduledPage.nextText(penny, now: Self.date("2026-10-12T09:20:00Z")) == "Due now")
        #expect(ScheduledPage.lastText(sid, now: now) == "Last ran 3 min ago")
        #expect(ScheduledPage.lastText(penny, now: now) == "Not run yet")
        #expect(ScheduledPage.ageText(page.teamTasks[0], now: Self.date("2026-10-14T00:00:00Z")) == "Waiting 2 days")
        #expect(ScheduledPage.span(90) == "1 min")
        #expect(ScheduledPage.span(86_400 + 60) == "1 day")
    }
}
