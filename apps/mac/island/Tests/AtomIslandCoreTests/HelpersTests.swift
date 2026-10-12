import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Helpers protocol (ADR-081)")
struct HelpersProtocolTests {
    func fields(_ command: IslandCommand) throws -> [String: Any] {
        let line = command.line
        #expect(line.hasSuffix("\n"))
        #expect(!line.dropLast().contains("\n"))
        return try #require(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
    }

    @Test func encodesTheFiveCommands() throws {
        #expect(IslandCommand.helpersList.line == #"{"type":"helpers.list"}"# + "\n")
        #expect(IslandCommand.helperSet(helper: "sid", app: "Brave Browser").line
            == #"{"app":"Brave Browser","helper":"sid","type":"helper.set"}"# + "\n")
        #expect(IslandCommand.helperSet(helper: "sid", app: "").line == #"{"app":"","helper":"sid","type":"helper.set"}"# + "\n")
        #expect(IslandCommand.jobStop(id: 12).line == #"{"id":12,"type":"job.stop"}"# + "\n") // a number, not "12"
        #expect(IslandCommand.jobDelete(id: 12).line == #"{"id":12,"type":"job.delete"}"# + "\n")
        let task = "research \"IPv6\"\\ \n → नेपाल 🎙 / {}"
        let add = try fields(.jobAdd(helper: "sid", task: task))
        #expect(add["type"] as? String == "job.add" && add["helper"] as? String == "sid" && add["task"] as? String == task)
        #expect(IslandCommand.jobAdd(helper: "sid", task: "x").type == "job.add")
    }

    static let helpersLine = #"""
    {"type":"helpers","apps":["Brave Browser","Notes"],"helpers":[
      {"id":"sid","name":"Sid","available":true,"app":"Brave Browser","jobs":[
        {"id":2,"task":"Research IPv6","state":"running","createdAt":"2026-10-10T09:30:00.000Z","step":"Reading 3 of 8 pages"},
        {"id":1,"task":"Research networking","state":"done","createdAt":"2026-10-10T08:00:00Z","endedAt":"2026-10-10T08:09:12.345Z",
         "partial":true,"title":"Networking basics","summary":"How packets find their way.","future":1},
        {"id":0,"task":"Research DNS","state":"failed","createdAt":"2026-10-10T07:00:00Z","error":"Sid needs the Claude plan for research."}
      ]},
      {"id":"kame","name":"Kame","available":false,"app":null,"jobs":[]},
      {"id":"puff","name":"Puff","available":false,"jobs":[]}
    ]}
    """#.replacingOccurrences(of: "\n", with: "")

    @Test func decodesHelpers() throws {
        guard case .helpers(let list) = try decodeEvent(Self.helpersLine) else { Issue.record("not helpers"); return }
        #expect(try decodeEvent(Self.helpersLine).name == "helpers")
        #expect(list.apps == ["Brave Browser", "Notes"])
        #expect(list.helpers.map(\.id) == ["sid", "kame", "puff"]) // the event's order
        let sid = list.helpers[0]
        #expect(sid.name == "Sid" && sid.available && sid.app == "Brave Browser")
        #expect(sid.activity == "Reading 3 of 8 pages")
        #expect(sid.jobs.map(\.state) == [.running, .done, .failed])
        let done = sid.jobs[1]
        #expect(done.hasReport && done.partial && done.badge == "Partial")
        #expect(done.title == "Networking basics" && done.summary == "How packets find their way.")
        #expect(done.createdAt == Date(timeIntervalSince1970: 1_791_619_200)) // without fractional seconds
        #expect(done.endedAt.map { abs($0.timeIntervalSince1970 - 1_791_619_752.345) < 0.001 } == true)
        #expect(sid.jobs[2].error == "Sid needs the Claude plan for research." && !sid.jobs[2].hasReport)
        #expect(list.helpers[1].app == nil && !list.helpers[1].available && list.helpers[1].activity == "Idle")
        #expect(list.helpers[2].app == nil) // app absent reads as none
    }

    @Test func rejectsMalformedHelpers() {
        let helper = #""id":"sid","name":"Sid","available":true,"app":null"#
        let job = #""id":1,"task":"t","createdAt":"2026-10-10T08:00:00Z""#
        let cases: [(String, ProtocolError)] = [
            (#"{"type":"helpers","apps":[]}"#, .missingField(event: "helpers", field: "helpers")),
            (#"{"type":"helpers","helpers":[]}"#, .missingField(event: "helpers", field: "apps")),
            (#"{"type":"helpers","helpers":{},"apps":[]}"#, .invalidValue(event: "helpers", field: "helpers")),
            (#"{"type":"helpers","helpers":[],"apps":["Notes",3]}"#, .invalidValue(event: "helpers", field: "apps")),
            (#"{"type":"helpers","helpers":[{"id":"sid","name":"Sid","available":"yes","jobs":[]}],"apps":[]}"#,
             .invalidValue(event: "helpers", field: "helpers")), // available not a boolean
            (#"{"type":"helpers","helpers":[{"id":"sid","name":"Sid","available":true,"app":5,"jobs":[]}],"apps":[]}"#,
             .invalidValue(event: "helpers", field: "helpers")), // app neither text nor null
            (#"{"type":"helpers","helpers":[{\#(helper)}],"apps":[]}"#, .invalidValue(event: "helpers", field: "helpers")), // no jobs
            (#"{"type":"helpers","helpers":[{\#(helper),"jobs":[{\#(job),"state":"paused"}]}],"apps":[]}"#,
             .invalidValue(event: "helpers", field: "helpers")), // unknown state
            (#"{"type":"helpers","helpers":[{\#(helper),"jobs":[{"id":"1","task":"t","state":"done","createdAt":"x"}]}],"apps":[]}"#,
             .invalidValue(event: "helpers", field: "helpers")), // id as text
            (#"{"type":"helpers","helpers":[{\#(helper),"jobs":[{"id":1,"task":"t","state":"done"}]}],"apps":[]}"#,
             .invalidValue(event: "helpers", field: "helpers")), // no createdAt
        ]
        for (line, expected) in cases {
            #expect(throws: expected, "\(line)") { try decodeEvent(line) }
        }
    }

    @Test func webURLAcceptsOnlyHttpAndHttps() {
        #expect(ReportSource.webURL("https://example.com") != nil)
        #expect(ReportSource.webURL("HTTP://example.com/x") != nil)
        for bad in ["javascript:alert(1)", "file:///etc/passwd", "mailto:a@b.c", "https://", "example.com", ""] {
            #expect(ReportSource.webURL(bad) == nil, "\(bad)")
        }
    }
}

@Suite("ZENO window state (ADR-081)")
struct HelpersStateTests {
    func list(_ line: String = HelpersProtocolTests.helpersLine) throws -> IslandEvent { try decodeEvent(line) }

    func loaded() throws -> HelpersState {
        var state = HelpersState()
        state.apply(try list())
        return state
    }

    @Test func selectsTheFirstAvailableHelper() throws {
        var state = HelpersState()
        #expect(state.selectedHelper == nil)
        state.apply(try list())
        #expect(state.selectedHelperId == "sid")
        state.selectHelper("nobody")
        #expect(state.selectedHelperId == "sid")
        state.selectHelper("kame") // not ready for jobs, but its soul can be shaped (Task 3.3)
        #expect(state.selectedHelperId == "kame")
        #expect(state.addJob("x") == nil)
    }

    @Test func appPickerSendsHelperSet() throws {
        var state = try loaded()
        #expect(state.setApp("Brave Browser") == nil) // already set
        #expect(state.setApp("Notes") == .helperSet(helper: "sid", app: "Notes"))
        #expect(state.isWaiting)
        #expect(state.setApp(nil) == .helperSet(helper: "sid", app: ""))
    }

    @Test func addJobTrimsAndRefusesEmptyOrLong() throws {
        var state = try loaded()
        #expect(state.addJob("  Research networking \n") == .jobAdd(helper: "sid", task: "Research networking"))
        #expect(state.addJob("   ") == nil)
        #expect(state.addJob(String(repeating: "a", count: 1001)) == nil)
        #expect(state.addJob(String(repeating: "a", count: 1000)) != nil)
        var empty = HelpersState()
        #expect(empty.addJob("x") == nil) // no helper yet
    }

    @Test func stopOnlyActiveJobsDeleteAny() throws {
        var state = try loaded()
        #expect(state.stopJob(2) == .jobStop(id: 2)) // running
        #expect(state.stopJob(1) == nil) // done
        #expect(state.stopJob(99) == nil)
        #expect(state.deleteJob(0) == .jobDelete(id: 0))
        #expect(state.deleteJob(99) == nil)
    }

    @Test func openingATaskAsksForItsThreadAndKeepsOnlyItsAnswer() throws {
        var state = try loaded()
        #expect(state.openThread(99) == nil) // no such task
        #expect(state.openThread(0) == .threadGet(id: 0)) // a failed task has a thread too
        #expect(state.openThread(1) == .threadGet(id: 1))
        #expect(state.openJob?.id == 1 && state.report == nil)
        state.apply(.thread(HelperThread(id: 7, comments: [], activity: [])))
        #expect(state.thread == nil) // not the open task's
        let mine = HelperReport(id: 1, title: "Networking basics", summary: "s", body: "b", sources: [])
        state.apply(.thread(HelperThread(id: 1, comments: [], activity: [], report: mine)))
        #expect(state.report == mine)
        state.closeReport()
        #expect(state.report == nil && state.openJobId == nil)
    }

    @Test func aDeletedTaskClosesItsThread() throws {
        var state = try loaded()
        _ = state.openThread(1)
        #expect(state.deleteJob(1) == .jobDelete(id: 1))
        #expect(state.thread == nil && state.openJobId == nil)
        // Deleted elsewhere (by voice, another window): the next list closes it too.
        _ = state.openThread(1)
        let without = HelpersProtocolTests.helpersLine.replacingOccurrences(of: #"{"id":1,"task":"Research networking","#, with: #"{"id":9,"task":"Research networking","#)
        state.apply(try list(without))
        #expect(state.openJobId == nil)
    }

    @Test func aRefusalBelongsToTheWindowOnlyWhileWaiting() throws {
        var state = try loaded()
        let refusal = IslandEvent.error(RuntimeError(stage: "settings", message: "Brave Browser is not installed."))
        state.apply(refusal)
        #expect(state.problem == nil) // not ours: e.g. a model switch
        _ = state.setApp("Notes")
        state.apply(.error(RuntimeError(stage: "model", message: "x")))
        #expect(state.problem == nil && state.isWaiting)
        state.apply(refusal)
        #expect(state.problem == "Brave Browser is not installed." && !state.isWaiting)
        state.apply(try list())
        #expect(state.problem == nil)
    }

    @Test func aListWithoutTheSelectedHelperPicksAgain() throws {
        var state = try loaded()
        let noSid = #"{"type":"helpers","apps":[],"helpers":[{"id":"puff","name":"Puff","available":true,"app":null,"jobs":[]}]}"#
        state.apply(try list(noSid))
        #expect(state.selectedHelperId == "puff")
        state.apply(try list(#"{"type":"helpers","apps":[],"helpers":[]}"#))
        #expect(state.selectedHelper == nil)
    }
}

@Suite("Helpers models (ADR-083)")
struct HelpersModelTests {
    static let line = #"""
    {"type":"helpers","apps":[],"allowLarge":false,"models":[
      {"id":"claude-haiku-4-5","name":"Claude Haiku 4.5","tier":"small"},
      {"id":"claude-sonnet-4-5","name":"Claude Sonnet 4.5","tier":"medium"},
      {"id":"claude-opus-4-5","name":"Claude Opus 4.5","tier":"large"}],
     "helpers":[{"id":"sid","name":"Sid","available":true,"app":null,"pinnedModel":"claude-sonnet-4-5","jobs":[
       {"id":2,"task":"t","state":"running","createdAt":"2026-10-10T08:00:00Z","model":"claude-haiku-4-5","modelReason":"Laya: trivial"},
       {"id":1,"task":"t","state":"done","createdAt":"2026-10-10T07:00:00Z","model":"claude-gone-1"},
       {"id":0,"task":"t","state":"queued","createdAt":"2026-10-10T06:00:00Z"}]}]}
    """#.replacingOccurrences(of: "\n", with: "")

    func loaded(_ line: String = Self.line) throws -> HelpersState {
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        return state
    }

    @Test func encodesPinAndSettings() {
        #expect(IslandCommand.helperPin(helper: "sid", model: "claude-opus-4-5").line
            == #"{"helper":"sid","model":"claude-opus-4-5","type":"helper.pin"}"# + "\n")
        #expect(IslandCommand.helperPin(helper: "sid", model: "").line == #"{"helper":"sid","model":"","type":"helper.pin"}"# + "\n")
        #expect(IslandCommand.helpersSettings(allowLarge: false).line == #"{"allowLarge":false,"type":"helpers.settings"}"# + "\n")
        #expect(IslandCommand.helpersSettings(allowLarge: true).line == #"{"allowLarge":true,"type":"helpers.settings"}"# + "\n")
    }

    @Test func decodesModelsPinAndJobModels() throws {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { Issue.record("not helpers"); return }
        #expect(!list.allowLarge)
        #expect(list.models.map(\.tier) == [.small, .medium, .large])
        let sid = list.helpers[0]
        #expect(sid.pinnedModel == "claude-sonnet-4-5")
        #expect(sid.jobs[0].model == "claude-haiku-4-5" && sid.jobs[0].modelReason == "Laya: trivial")
        #expect(list.modelLine(sid.jobs[0]) == "Haiku 4.5 · Laya: trivial")
        #expect(list.modelLine(sid.jobs[1]) == "claude-gone-1") // not offered any more: the id
        #expect(list.modelLine(sid.jobs[2]) == nil)
    }

    @Test func anOlderRuntimeSendsNone() throws {
        guard case .helpers(let list) = try decodeEvent(HelpersProtocolTests.helpersLine) else { Issue.record("not helpers"); return }
        #expect(list.allowLarge && list.models.isEmpty)
        #expect(list.helpers[0].pinnedModel == nil && list.helpers[0].jobs[0].model == nil && list.modelLine(list.helpers[0].jobs[0]) == nil)
    }

    @Test func rejectsMalformedModels() {
        let helpers = #""helpers":[],"apps":[]"#
        let cases: [(String, ProtocolError)] = [
            (#"{"type":"helpers",\#(helpers),"models":[{"id":"x","name":"X","tier":"huge"}]}"#, .invalidValue(event: "helpers", field: "models")),
            (#"{"type":"helpers",\#(helpers),"models":[{"id":"x","name":"X"}]}"#, .invalidValue(event: "helpers", field: "models")),
            (#"{"type":"helpers",\#(helpers),"models":{}}"#, .invalidValue(event: "helpers", field: "models")),
            (#"{"type":"helpers",\#(helpers),"allowLarge":"no"}"#, .invalidValue(event: "helpers", field: "allowLarge")),
            (#"{"type":"helpers","apps":[],"helpers":[{"id":"sid","name":"Sid","available":true,"pinnedModel":3,"jobs":[]}]}"#,
             .invalidValue(event: "helpers", field: "helpers")),
        ]
        for (line, expected) in cases {
            #expect(throws: expected, "\(line)") { try decodeEvent(line) }
        }
    }

    @Test func pinSendsHelperPin() throws {
        var state = try loaded()
        #expect(state.pinModel("claude-sonnet-4-5") == nil) // already pinned
        #expect(state.pinModel("claude-unknown") == nil)
        #expect(state.pinModel("claude-opus-4-5") == .helperPin(helper: "sid", model: "claude-opus-4-5"))
        #expect(state.isWaiting)
        #expect(state.pinModel(nil) == .helperPin(helper: "sid", model: "")) // Chosen by Laya
        var older = try loaded(HelpersProtocolTests.helpersLine)
        #expect(older.pinModel("claude-opus-4-5") == nil && older.pinModel(nil) == nil) // no models: not the Claude plan
    }

    @Test func allowLargeSendsSettings() throws {
        var state = try loaded()
        #expect(state.setAllowLarge(false) == nil) // unchanged
        #expect(state.setAllowLarge(true) == .helpersSettings(allowLarge: true))
        var older = try loaded(HelpersProtocolTests.helpersLine)
        #expect(older.setAllowLarge(false) == nil)
        var empty = HelpersState()
        #expect(empty.setAllowLarge(false) == nil)
    }
}

@Suite("Helpers progress line (ADR-084)")
struct HelpersProgressTests {
    @Test func readsNOfMFromARunningJobsStep() {
        #expect(HelperJob(id: 1, task: "", state: .running, step: "Reading 3 of 8 pages").progress == 3.0 / 8)
        #expect(HelperJob.progress(in: "Page 8 of 8.") == 1)
        #expect(HelperJob.progress(in: "0 of 5 sources checked") == 0)
    }

    @Test func noLineWithoutATrustworthyCount() {
        #expect(HelperJob(id: 1, task: "", state: .running, step: "Writing the report").progress == nil)
        #expect(HelperJob(id: 1, task: "", state: .running).progress == nil)
        #expect(HelperJob(id: 1, task: "", state: .queued, step: "Reading 3 of 8 pages").progress == nil) // not running
        #expect(HelperJob.progress(in: "Reading 9 of 8 pages") == nil)
        #expect(HelperJob.progress(in: "Reading 3 of 0 pages") == nil)
        #expect(HelperJob.progress(in: "One of the pages") == nil)
        #expect(HelperJob.progress(in: "of 8") == nil)
    }
}

@Suite("Helper souls (ADR-082, Task 3.3)")
struct HelperSoulTests {
    static let line = #"""
    {"type":"helpers","apps":[],"helpers":[
      {"id":"sid","name":"Scout","available":true,"app":null,"role":"researcher","jobs":[],
       "soul":{"name":"Scout","personality":"Curious.","howItWorks":"Searches twice.","rules":"","lessons":"Three sources."},
       "soulVersion":3,"soulVersions":[{"version":3,"createdAt":"2026-10-11T09:00:00.000Z"},{"version":2,"createdAt":"2026-10-10T09:00:00Z"},
       {"version":1,"createdAt":"2026-10-09T09:00:00Z"}]},
      {"id":"penny","name":"Penny","available":true,"app":null,"role":"financial adviser","jobs":[],
       "soul":{"name":"Penny","personality":"Cautious.","howItWorks":"","rules":"","lessons":""},"soulVersion":1,
       "soulVersions":[{"version":1,"createdAt":"2026-10-09T09:00:00Z"}]}
    ]}
    """#.replacingOccurrences(of: "\n", with: "")

    func loaded() throws -> HelpersState {
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        return state
    }

    @Test func decodesRoleSoulAndVersions() throws {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { Issue.record("not helpers"); return }
        let sid = list.helpers[0]
        #expect(sid.role == "researcher" && sid.roleTitle == "Researcher")
        #expect(sid.soul == HelperSoul(name: "Scout", personality: "Curious.", howItWorks: "Searches twice.", lessons: "Three sources."))
        #expect(sid.soulVersion == 3 && sid.soulVersions.map(\.version) == [3, 2, 1])
        #expect(sid.soulVersions[0].createdAt != nil)
        #expect(list.helpers[1].roleTitle == "Financial information")
    }

    @Test func aMalformedSoulMakesTheEventInvalid() {
        for bad in [#""soul":{"name":"Sid"}"#, #""soul":"Sid""#, #""soulVersions":[{"version":"2"}]"#] {
            let line = #"{"type":"helpers","apps":[],"helpers":[{"id":"sid","name":"Sid","available":true,"jobs":[],\#(bad)}]}"#
            #expect(throws: ProtocolError.invalidValue(event: "helpers", field: "helpers")) { try decodeEvent(line) }
        }
    }

    @Test func anOlderRuntimeWithoutSoulsStillDecodes() throws {
        let line = #"{"type":"helpers","apps":[],"helpers":[{"id":"sid","name":"Sid","available":true,"jobs":[]}]}"#
        guard case .helpers(let list) = try decodeEvent(line) else { Issue.record("not helpers"); return }
        #expect(list.helpers[0].soul == nil && list.helpers[0].role == "")
        var state = HelpersState()
        state.apply(.helpers(list))
        state.openSoul()
        #expect(!state.isSoulOpen) // nothing to edit
    }

    /// ADR-091: renaming a worker saves its soul with the new name, checked like any soul.
    @Test func renameSavesANewSoulVersionWithTheName() throws {
        var state = try loaded()
        var expected = try #require(state.selectedHelper?.soul)
        expected.name = "Ace"
        #expect(state.rename("  Ace ") == .soulSet(helper: "sid", soul: expected.trimmed))
        var again = try loaded()
        #expect(again.rename(String(repeating: "a", count: 21)) == nil && again.problem?.hasPrefix("The name is too long") == true)
        #expect(IslandCommand.speechSet(reports: false, updates: true, chime: true).line == #"{"chime":true,"reports":false,"type":"speech.set","updates":true}"# + "\n")
    }

    @Test func saveSendsTheTrimmedSoulOnlyWhenChangedAndValid() throws {
        var state = try loaded()
        state.openSoul()
        #expect(state.isSoulOpen)
        let current = try #require(state.selectedHelper?.soul)
        #expect(state.saveSoul(current) == nil) // unchanged
        var edited = current
        edited.lessons = "  Three sources, always.\n"
        #expect(state.saveSoul(edited) == .soulSet(helper: "sid", soul: HelperSoul(name: "Scout", personality: "Curious.",
                                                                              howItWorks: "Searches twice.", lessons: "Three sources, always.")))
        #expect(state.isWaiting)
        edited.personality = "   "
        #expect(state.saveSoul(edited) == nil && state.problem == "The personality is empty.")
        edited.personality = "x"
        edited.name = String(repeating: "a", count: 21)
        #expect(state.saveSoul(edited) == nil && state.problem?.hasPrefix("The name is too long") == true)
    }

    @Test func restoreSendsOnlyAnOlderListedVersion() throws {
        var state = try loaded()
        #expect(state.restoreSoul(3) == nil) // current
        #expect(state.restoreSoul(9) == nil) // not listed
        #expect(state.restoreSoul(1) == .soulRestore(helper: "sid", version: 1))
    }

    @Test func choosingAnotherWorkerOrAReportClosesTheSoul() throws {
        var state = try loaded()
        state.openSoul()
        state.selectHelper("penny")
        #expect(!state.isSoulOpen)
        state.openSoul()
        state.closeSoul()
        #expect(!state.isSoulOpen)
    }

    @Test func encodesSoulCommands() throws {
        let soul = HelperSoul(name: "Sid", personality: "Curious \"and\" thorough\n", howItWorks: "a", rules: "b", lessons: "c")
        let line = IslandCommand.soulSet(helper: "sid", soul: soul).line
        let fields = try #require(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        #expect(fields["type"] as? String == "soul.set" && fields["helper"] as? String == "sid")
        let sent = try #require(fields["soul"] as? [String: String])
        #expect(sent == ["name": "Sid", "personality": "Curious \"and\" thorough\n", "howItWorks": "a", "rules": "b", "lessons": "c"])
        #expect(IslandCommand.soulRestore(helper: "sid", version: 2).line == #"{"helper":"sid","type":"soul.restore","version":2}"# + "\n")
    }
}

@Suite("Tasks, board and threads (ADR-087, Task 3.4)")
struct HelperTaskTests {
    static let line = #"""
    {"type":"helpers","apps":[],"helpers":[
      {"id":"sid","name":"Sid","available":true,"app":null,"jobs":[
        {"id":4,"task":"Old","state":"stopped","createdAt":"2026-10-10T07:00:00Z","blockedBy":[],"waitingFor":[],"comments":0},
        {"id":3,"task":"Broken","state":"failed","createdAt":"2026-10-10T08:00:00Z","error":"x","blockedBy":[],"waitingFor":[],"comments":0},
        {"id":2,"task":"Research IPv6","state":"running","createdAt":"2026-10-10T09:00:00Z","blockedBy":[],"waitingFor":[],"comments":0},
        {"id":1,"task":"Research networking","state":"done","createdAt":"2026-10-10T06:00:00Z","title":"Networking basics","summary":"s",
         "blockedBy":[],"waitingFor":[],"comments":2}]},
      {"id":"hana","name":"Hana","available":true,"app":null,"jobs":[
        {"id":6,"task":"Then this","state":"queued","createdAt":"2026-10-10T09:06:00Z","blockedBy":[],"waitingFor":[],"comments":0},
        {"id":5,"task":"Write the guide","state":"queued","createdAt":"2026-10-10T09:05:00Z","blockedBy":[1,2],"waitingFor":[2],
         "comments":1,"goal":"A networking guide","parentId":1}]}
    ]}
    """#.replacingOccurrences(of: "\n", with: "")

    func loaded(_ line: String = Self.line) throws -> HelpersState {
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        return state
    }

    @Test func decodesTaskFields() throws {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { Issue.record("not helpers"); return }
        let guide = try #require(list.item(5))
        #expect(guide.helperName == "Hana" && guide.job.blockedBy == [1, 2] && guide.job.waitingFor == [2])
        #expect(guide.job.comments == 1 && guide.job.goal == "A networking guide" && guide.job.parentId == 1 && guide.job.isWaiting)
        #expect(list.item(1)?.job.shortTitle == "Networking basics")
        #expect(list.item(6)?.job.isWaiting == false)
    }

    @Test func theBoardGroupsEveryWorkersTasks() throws {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { Issue.record("not helpers"); return }
        let board = list.board
        #expect(board.map(\.column) == [.needsYou, .running, .toDo, .done])
        #expect(board.map { $0.items.map(\.id) } == [[3], [2], [5, 6], [4, 1]]) // to do in run order, the rest newest first
        #expect(list.waitable.map(\.id) == [6, 5, 2, 1]) // not failed or stopped
    }

    @Test func aTaskCanWaitForOthersWhenAdded() throws {
        var state = try loaded()
        state.toggleDraftBlocker(1)
        state.toggleDraftBlocker(3) // failed: cannot be waited for
        state.toggleDraftBlocker(2)
        state.toggleDraftBlocker(2)
        #expect(state.draftBlockers == [1])
        #expect(state.addJob("Summarise it") == .jobAdd(helper: "sid", task: "Summarise it", blockedBy: [1]))
        #expect(state.draftBlockers.isEmpty)
    }

    @Test func aQueuedTasksBlockersCanChangeNotAStartedOnes() throws {
        var state = try loaded()
        _ = state.openThread(5)
        #expect(state.toggleBlocker(2) == .jobBlock(id: 5, blockedBy: [1]))
        #expect(state.toggleBlocker(6) == .jobBlock(id: 5, blockedBy: [1, 2, 6]))
        #expect(state.toggleBlocker(5) == nil) // itself
        _ = state.openThread(2)
        #expect(state.toggleBlocker(1) == nil) // running
    }

    @Test func notesGoToTheOpenTask() throws {
        var state = try loaded()
        #expect(state.addComment("x") == nil) // nothing open
        _ = state.openThread(5)
        #expect(state.addComment("  Keep it short ") == .commentAdd(id: 5, text: "Keep it short"))
        #expect(state.addComment("   ") == nil)
        #expect(state.addComment(String(repeating: "a", count: 2001)) == nil)
    }

    @Test func theOpenThreadIsAskedForAgainWhenItsTaskChanges() throws {
        var state = try loaded()
        _ = state.openThread(5)
        state.apply(try decodeEvent(Self.line))
        #expect(state.takeRefresh() == nil) // nothing changed
        state.apply(try decodeEvent(Self.line.replacingOccurrences(of: #""comments":1,"goal""#, with: #""comments":2,"goal""#)))
        #expect(state.takeRefresh() == .threadGet(id: 5))
        #expect(state.takeRefresh() == nil) // taken once
    }

    @Test func theBoardAndAWorkerAreTwoPlaces() throws {
        var state = try loaded()
        state.selectBoard()
        #expect(state.showsBoard)
        _ = state.openThread(5)
        state.selectBoard()
        #expect(state.openJobId == nil) // back to the board
        state.selectHelper("hana")
        #expect(!state.showsBoard && state.selectedHelperId == "hana")
    }

    @Test func decodesToolCalls() throws {
        let line = #"{"type":"thread","id":5,"comments":[],"activity":[],"toolCalls":[{"id":"a","tool":"Read","input":"x.md","state":"ok","result":"fine","at":"2026-10-10T09:05:00Z","ms":2300},{"id":"b","agent":"coder","tool":"Bash","input":"ls","state":"started","at":"2026-10-10T09:06:00.250Z"},{"id":"c","tool":"Bash","input":"","state":"weird","at":"2026-10-10T09:06:00Z"}]}"#
        guard case .thread(let thread) = try decodeEvent(line) else { Issue.record("not a thread"); return }
        #expect(thread.toolCalls.map(\.id) == ["a", "b"]) // the bad state is left out
        #expect(thread.toolCalls[0].state == .ok && thread.toolCalls[0].result == "fine" && thread.toolCalls[0].durationMs == 2300)
        #expect(thread.toolCalls[1].agent == "coder" && thread.toolCalls[1].state == .started && thread.toolCalls[1].durationMs == nil)
        guard case .thread(let bare) = try decodeEvent(#"{"type":"thread","id":5,"comments":[],"activity":[]}"#) else { return }
        #expect(bare.toolCalls.isEmpty) // an older runtime
    }

    @Test func formatsToolCallDurations() {
        func text(_ ms: Int?) -> String? { HelperToolCall(id: "a", tool: "t", input: "", state: .ok, at: Date(), durationMs: ms).durationText }
        #expect(text(nil) == nil && text(850) == "850 ms" && text(2300) == "2.3s" && text(65_000) == "1m 5s")
    }

    @Test func decodesAThread() throws {
        let line = #"{"type":"thread","id":5,"comments":[{"id":1,"text":"Keep it short","createdAt":"2026-10-10T09:05:00Z"}],"activity":[{"kind":"created","at":"2026-10-10T09:05:00Z"},{"kind":"commented","at":"2026-10-10T09:06:00Z"}],"report":{"title":"T","summary":"S","body":"B","sources":[{"title":"x","url":"javascript:alert(1)"},{"title":"y","url":"https://example.org/"}]}}"#
        guard case .thread(let thread) = try decodeEvent(line) else { Issue.record("not a thread"); return }
        #expect(thread.id == 5 && thread.comments.map(\.text) == ["Keep it short"] && thread.comments[0].createdAt != nil)
        #expect(thread.activity.map(\.title) == ["Added", "Note added"])
        #expect(thread.report?.id == 5 && thread.report?.sources.map(\.title) == ["y"]) // web sources only
        let bare = #"{"type":"thread","id":5,"comments":[],"activity":[]}"#
        guard case .thread(let empty) = try decodeEvent(bare) else { Issue.record("not a thread"); return }
        #expect(empty.report == nil)
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"thread","id":5,"comments":"x","activity":[]}"#) }
    }

    @Test func encodesTaskCommands() throws {
        #expect(IslandCommand.jobAdd(helper: "sid", task: "x").line == #"{"helper":"sid","task":"x","type":"job.add"}"# + "\n")
        #expect(IslandCommand.jobAdd(helper: "sid", task: "x", blockedBy: [1, 2]).line
            == #"{"blockedBy":[1,2],"helper":"sid","task":"x","type":"job.add"}"# + "\n")
        #expect(IslandCommand.jobBlock(id: 5, blockedBy: []).line == #"{"blockedBy":[],"id":5,"type":"job.block"}"# + "\n")
        #expect(IslandCommand.commentAdd(id: 5, text: "a \"b\"").line == #"{"id":5,"text":"a \"b\"","type":"comment.add"}"# + "\n")
        #expect(IslandCommand.threadGet(id: 5).line == #"{"id":5,"type":"thread.get"}"# + "\n")
    }
}

@Suite("Goals Pal hands out (Task 3.5)")
struct HelperGoalTests {
    @Test func decodesAThreadsGoalAndItsCombinedReport() throws {
        let line = #"{"type":"thread","id":5,"comments":[],"activity":[],"goal":{"id":2,"text":"networking guide","ended":true,"tasks":[1,5],"report":{"title":"T","summary":"S","body":"B","sources":[{"title":"x","url":"file:///etc/passwd"},{"title":"y","url":"https://example.org/"}]}}}"#
        guard case .thread(let thread) = try decodeEvent(line) else { Issue.record("not a thread"); return }
        let goal = try #require(thread.goal)
        #expect(goal.id == 2 && goal.text == "networking guide" && goal.ended && goal.tasks == [1, 5])
        #expect(goal.report?.title == "T" && goal.report?.sources.map(\.title) == ["y"])
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"thread","id":5,"comments":[],"activity":[],"goal":{"id":2,"text":"g","ended":1,"tasks":[]}}"#) }
    }

    @Test func aGoalEndingAsksForTheOpenThreadAgain() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(HelperTaskTests.line))
        _ = state.openThread(5)
        state.apply(try decodeEvent(HelperTaskTests.line))
        #expect(state.takeRefresh() == nil)
        let ended = HelperTaskTests.line.replacingOccurrences(of: #""parentId":1"#, with: #""parentId":1,"goalId":2,"goalEnded":true"#)
        state.apply(try decodeEvent(ended))
        #expect(state.openJob?.goalId == 2 && state.openJob?.goalEnded == true)
        #expect(state.takeRefresh() == .threadGet(id: 5))
    }

    @Test func progressCountsDoneTasks() throws {
        guard case .helpers(let list) = try decodeEvent(HelperTaskTests.line) else { Issue.record("not helpers"); return }
        #expect(HelperGoal(id: 1, text: "g", ended: false, tasks: [1, 5]).progress(in: list) == "Working: 1 of 2 tasks done.")
        let report = HelperReport(id: 1, title: "T", summary: "S", body: "B", sources: [])
        #expect(HelperGoal(id: 1, text: "g", ended: true, tasks: [1, 3], report: report).progress(in: list) == "1 of 2 tasks done.")
        #expect(HelperGoal(id: 1, text: "g", ended: true, tasks: [3]).progress(in: list) == "No task finished.")
    }
}

@Suite("Wake-ups and memory (Task 3.6)")
struct HelperWakeTests {
    @Test func startFreshIsForAnEndedTaskWithASession() throws {
        let line = HelperTaskTests.line.replacingOccurrences(of: #""comments":2}"#, with: #""comments":2,"resumable":true}"#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        #expect(state.list?.item(1)?.job.resumable == true && state.list?.item(2)?.job.resumable == false)
        #expect(state.startFresh() == nil) // nothing open
        _ = state.openThread(2)
        #expect(state.startFresh() == nil) // running, and no session
        _ = state.openThread(1)
        #expect(state.startFresh() == .jobFresh(id: 1))
        #expect(IslandCommand.jobFresh(id: 1).line == #"{"id":1,"type":"job.fresh"}"# + "\n")
    }

    @Test func decodesCheckpoints() throws {
        let line = #"{"type":"thread","id":5,"comments":[],"activity":[],"bashRan":true,"checkpoints":[{"path":"a/b.md","kind":"modified","state":"ready"},{"path":"c.txt","kind":"created","state":"skipped","reason":"too big"},{"path":"d","kind":"created","state":"weird"},{"path":"e","kind":"deleted","state":"ready"}]}"#
        guard case .thread(let thread) = try decodeEvent(line) else { Issue.record("not a thread"); return }
        #expect(thread.checkpoints == [HelperCheckpoint(path: "a/b.md", kind: .modified, state: .ready),
                                       HelperCheckpoint(path: "c.txt", kind: .created, state: .skipped, reason: "too big")])
        #expect(thread.bashRan)
        guard case .thread(let bare) = try decodeEvent(#"{"type":"thread","id":5,"comments":[],"activity":[]}"#) else { return }
        #expect(bare.checkpoints.isEmpty && !bare.bashRan) // an older runtime
    }

    @Test func undoCommandEncoding() {
        #expect(IslandCommand.jobUndo(id: 3).line == #"{"id":3,"type":"job.undo"}"# + "\n")
        #expect(IslandCommand.jobUndo(id: 3, path: "a/b.md", force: true).line == #"{"force":true,"id":3,"path":"a/b.md","type":"job.undo"}"# + "\n")
    }

    @Test func activityNamesTheWakeUps() {
        #expect(TaskActivity(kind: "woken", at: nil).title == "Asked again")
        #expect(TaskActivity(kind: "fresh", at: nil).title == "Set to start fresh")
    }
}

@Suite("Budgets (Task 3.7)")
struct HelperBudgetTests {
    static let line = HelperTaskTests.line
        .replacingOccurrences(of: #"{"type":"helpers","apps":[],"helpers":["#, with: #"{"type":"helpers","apps":[],"team":{"cap":15,"spent":12.5},"planLimit":80,"helpers":["#)
        .replacingOccurrences(of: #""name":"Sid","available":true,"app":null,"jobs""#, with: #""name":"Sid","available":true,"app":null,"budget":{"cap":5,"spent":5.2},"jobs""#)
        .replacingOccurrences(of: #""id":6,"task":"Then this","state":"queued","#, with: #""id":6,"task":"Then this","state":"queued","held":"Hana's daily budget ($5.00) is used up.","#)

    @Test func decodesCapsSpendAndHolds() throws {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { Issue.record("not helpers"); return }
        #expect(list.team == HelperBudget(cap: 15, spent: 12.5) && list.planLimit == 80)
        let sid = try #require(list.helpers.first)
        #expect(sid.budget == HelperBudget(cap: 5, spent: 5.2) && sid.budget?.isOver == true)
        #expect(list.helpers.last?.budget == nil) // an older runtime sends none
        #expect(list.item(6)?.job.held == "Hana's daily budget ($5.00) is used up.")
        #expect(list.board.first { $0.column == .needsYou }?.items.map(\.id) == [6, 3]) // held with the failed
        #expect(throws: Never.self) { try decodeEvent(HelperTaskTests.line) } // budgets are optional
    }

    @Test func linesWarnAt80PercentAndSayWhenUsedUp() {
        #expect(HelperBudget(cap: 5, spent: 1.2).line == "$1.20 of $5.00 today")
        #expect(HelperBudget(cap: nil, spent: 1.2).line == "$1.20 today")
        #expect(HelperBudget(cap: 5, spent: 4).isNear && !HelperBudget(cap: 5, spent: 3.9).isNear)
        #expect(!HelperBudget(cap: 5, spent: 5).isNear && HelperBudget(cap: 5, spent: 5).isOver)
        #expect(!HelperBudget(cap: nil, spent: 999).isOver)
        #expect(HelperBudget.capTitle(5) == "$5 a day" && HelperBudget.capTitle(nil) == "No cap")
    }

    @Test func capsAndThePlanLimitAreCommands() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        #expect(state.setBudget(5) == nil) // unchanged
        #expect(state.setBudget(10) == .helperBudget(helper: "sid", cap: 10))
        #expect(state.setTeamBudget(nil) == .helperBudget(helper: "team", cap: nil))
        #expect(state.setPlanLimit(80) == nil && state.setPlanLimit(5) == nil)
        #expect(state.setPlanLimit(60) == .helpersPlanLimit(60))
        #expect(IslandCommand.helperBudget(helper: "team", cap: nil).line == #"{"cap":null,"helper":"team","type":"helper.budget"}"# + "\n")
        #expect(IslandCommand.helperBudget(helper: "sid", cap: 2.5).line == #"{"cap":2.5,"helper":"sid","type":"helper.budget"}"# + "\n")
        #expect(IslandCommand.helpersPlanLimit(60).line == #"{"planLimit":60,"type":"helpers.settings"}"# + "\n")
    }
}

@Suite("Runs at once (ADR-095)")
struct RunsAtOnceTests {
    static let line = HelperBudgetTests.line.replacingOccurrences(of: #""planLimit":80,"#, with: #""planLimit":80,"maxRunning":6,"#)

    @Test func decodesTheLimitAndChangesItWithinOneToTen() throws {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { Issue.record("not helpers"); return }
        #expect(list.maxRunning == 6)
        guard case .helpers(let older) = try decodeEvent(HelperBudgetTests.line) else { Issue.record("not helpers"); return }
        #expect(older.maxRunning == nil, "an older runtime sends none")
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        #expect(state.setMaxRunning(6) == nil && state.setMaxRunning(0) == nil && state.setMaxRunning(11) == nil)
        #expect(state.setMaxRunning(3) == .helpersMaxRunning(3))
        #expect(IslandCommand.helpersMaxRunning(3).line == #"{"maxRunning":3,"type":"helpers.settings"}"# + "\n")
    }

    @Test func aWorkerWithTwoRunsShowsTheNewestAndTheCount() {
        let now = Date()
        var newer = HelperJob(id: 2, task: "t", state: .running, createdAt: now.addingTimeInterval(-60))
        newer.step = "Reading 3 of 8 pages"
        let older = HelperJob(id: 1, task: "t", state: .running, createdAt: now.addingTimeInterval(-600))
        let sid = Helper(id: "sid", name: "Sid", available: true, app: nil, jobs: [newer, older])
        #expect(sid.activity == "2 at work · Reading 3 of 8 pages")
        #expect(TeamRoster.startedAt(sid) == now.addingTimeInterval(-600), "the longest-running one")
        let seat = OfficePlan(list: HelpersList(helpers: [sid], apps: []), now: now).seats.first
        #expect(seat?.bubble == "2 at work · Reading 3 of 8 pages" && seat?.taskId == 2 && seat?.animation == "working")
        #expect(TeamOverview(list: HelpersList(helpers: [sid], apps: []), now: now).running == 2)
    }
}

@Suite("Plan first (Task 3.8)")
struct HelperPlanTests {
    static let line = HelperTaskTests.line
        .replacingOccurrences(of: #""name":"Sid","available":true,"app":null,"jobs""#, with: #""name":"Sid","available":true,"app":null,"planFirst":true,"jobs""#)
        .replacingOccurrences(of: #""id":6,"task":"Then this","state":"queued","#, with: #""id":6,"task":"Then this","state":"queued","planFirst":true,"planStatus":"awaiting","planSummary":"Search, then compare.","held":"Hana's plan waits for your OK.","#)

    @Test func decodesPlanFields() throws {
        guard case .helpers(let list) = try decodeEvent(Self.line) else { Issue.record("not helpers"); return }
        #expect(list.helpers.first?.planFirst == true && list.helpers.last?.planFirst == false)
        let job = try #require(list.item(6)?.job)
        #expect(job.planFirst && job.awaitsApproval && job.planSummary == "Search, then compare.")
        #expect(list.board.first?.column == .needsYou)
        let thread = #"{"type":"thread","id":6,"comments":[],"activity":[{"kind":"planned","at":"2026-10-10T09:05:00Z"}],"plan":{"summary":"S","steps":"1. a\n\n2. b"}}"#
        guard case .thread(let t) = try decodeEvent(thread) else { Issue.record("not a thread"); return }
        #expect(t.plan?.lines == ["1. a", "2. b"] && t.activity.first?.title == "Wrote a plan")
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"thread","id":6,"comments":[],"activity":[],"plan":{"summary":"S"}}"#) }
    }

    @Test func approveAndRejectOnlyAWaitingPlan() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        _ = state.openThread(5)
        #expect(state.approvePlan() == nil)
        _ = state.openThread(6)
        #expect(state.approvePlan() == .planApprove(id: 6))
        #expect(state.rejectPlan() == .planReject(id: 6))
        #expect(state.setPlanFirst(true) == nil) // Sid's is already on
        #expect(state.setPlanFirst(false) == .helperPlanFirst(helper: "sid", on: false))
        #expect(IslandCommand.helperPlanFirst(helper: "sid", on: false).line == #"{"helper":"sid","on":false,"type":"helper.planFirst"}"# + "\n")
        #expect(IslandCommand.planApprove(id: 6).line == #"{"id":6,"type":"plan.approve"}"# + "\n")
    }
}

@Suite("Routines (Task 3.9)")
struct HelperRoutineTests {
    @Test func decodesRoutinesAndRemovesOne() throws {
        let line = HelperTaskTests.line.replacingOccurrences(of: #""name":"Sid","available":true,"app":null,"jobs""#,
            with: #""name":"Sid","available":true,"app":null,"routines":[{"id":2,"task":"News","when":"Every day at 8:00 AM","lastAt":"2026-10-11T08:00:00Z","lastSkipped":true},{"bad":1}],"jobs""#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        let sid = try #require(state.selectedHelper)
        #expect(sid.routines.map(\.id) == [2] && sid.routines[0].lastSkipped && sid.routines[0].lastAt != nil)
        #expect(state.deleteRoutine(9) == nil)
        #expect(state.deleteRoutine(2) == .routineDelete(id: 2))
        #expect(IslandCommand.routineDelete(id: 2).line == #"{"id":2,"type":"routine.delete"}"# + "\n")
    }
}

@Suite("Hand-offs (Task 3.10)")
struct HelperHandOffTests {
    @Test func decodesAThreadsSubTasks() throws {
        let line = #"{"type":"thread","id":1,"comments":[],"activity":[{"kind":"handed","at":"2026-10-11T08:00:00Z"}],"handOffs":[2,3]}"#
        guard case .thread(let thread) = try decodeEvent(line) else { Issue.record("not a thread"); return }
        #expect(thread.handOffs == [2, 3] && thread.activity.first?.title == "Handed off a sub-task")
        guard case .thread(let bare) = try decodeEvent(#"{"type":"thread","id":1,"comments":[],"activity":[]}"#) else { return }
        #expect(bare.handOffs.isEmpty)
    }
}

@Suite("Folder grants (Task 3.11)")
struct HelperGrantTests {
    @Test func decodesGrantsAndAsksToAddOrRemove() throws {
        let line = HelperTaskTests.line
            .replacingOccurrences(of: #"{"id":"hana","name":"Hana","available":true,"app":null,"jobs""#,
                                  with: #"{"id":"kame","name":"Kame","available":true,"app":null,"role":"coder","grants":["/Users/k/Developer/app"],"jobs":[]},{"id":"hana","name":"Hana","available":true,"app":null,"jobs""#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        #expect(state.addGrant("/Users/k/x") == nil) // Sid does not work in folders
        state.selectHelper("kame")
        let kame = try #require(state.selectedHelper)
        #expect(kame.worksInFolders && kame.grants == ["/Users/k/Developer/app"])
        #expect(state.addGrant("/Users/k/Developer/app") == nil) // already granted
        #expect(state.addGrant("/Users/k/Developer/site") == .grantAdd(helper: "kame", path: "/Users/k/Developer/site"))
        #expect(state.removeGrant("/Users/k/Developer/app") == .grantRemove(helper: "kame", path: "/Users/k/Developer/app"))
        #expect(IslandCommand.grantAdd(helper: "kame", path: "/a b").line == #"{"helper":"kame","path":"/a b","type":"grant.add"}"# + "\n")
    }
}

@Suite("Skills (Task 3.12)")
struct HelperSkillTests {
    @Test func decodesSkillsAndTogglesThem() throws {
        let line = HelperTaskTests.line
            .replacingOccurrences(of: #"{"type":"helpers","apps":[],"#, with: #"{"type":"helpers","apps":[],"skills":[{"name":"council","description":"Four voices."},{"name":"pdf","description":"PDFs."}],"#)
            .replacingOccurrences(of: #""name":"Sid","available":true,"app":null,"jobs""#, with: #""name":"Sid","available":true,"app":null,"skills":["pdf"],"jobs""#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        #expect(state.list?.skills.map(\.name) == ["council", "pdf"] && state.selectedHelper?.skills == ["pdf"])
        #expect(state.toggleSkill("council") == .helperSkills(helper: "sid", skills: ["council", "pdf"]))
        #expect(state.toggleSkill("pdf") == .helperSkills(helper: "sid", skills: []))
        #expect(state.toggleSkill("secret") == nil) // not one of Keshab's
        #expect(IslandCommand.helperSkills(helper: "sid", skills: ["pdf"]).line == #"{"helper":"sid","skills":["pdf"],"type":"helper.skills"}"# + "\n")
    }
}

@Suite("Tinker and feedback (Task 3.13)")
struct HelperFeedbackTests {
    @Test func ratesFinishedTasksAndAnswersProposals() throws {
        let line = HelperTaskTests.line
            .replacingOccurrences(of: #""name":"Sid","available":true,"app":null,"jobs""#,
                                  with: #""name":"Sid","available":true,"app":null,"proposals":[{"id":4,"field":"lessons","text":"Three sources.","reason":"Thin.","jobId":1,"state":"pending","createdAt":"2026-10-11T08:00:00Z"},{"id":3,"field":"rules","text":"x","reason":"y","jobId":1,"state":"accepted","createdAt":"2026-10-11T08:00:00Z"}],"jobs""#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        let sid = try #require(state.selectedHelper)
        #expect(sid.proposals.map(\.id) == [4, 3] && sid.proposals[0].fieldTitle == "Lessons learned")
        #expect(state.answerProposal(4, accept: true) == .proposalAccept(id: 4))
        #expect(state.answerProposal(3, accept: true) == nil) // not pending
        #expect(state.undoProposal(3) == .proposalUndo(id: 3))
        _ = state.openThread(2)
        #expect(state.rate(good: true) == nil) // running
        _ = state.openThread(1)
        #expect(state.rate(good: false, comment: "  Thin ") == .jobRate(id: 1, good: false, comment: "Thin"))
        #expect(IslandCommand.jobRate(id: 1, good: true, comment: nil).line == #"{"good":true,"id":1,"type":"job.rate"}"# + "\n")
    }
}

@Suite("Skills that grow (ADR-094)")
struct SkillsThatGrowTests {
    static let line = HelperTaskTests.line.replacingOccurrences(of: #"{"type":"helpers","#, with: #"{"type":"helpers","skills":[{"name":"pdf","description":"PDFs","source":"yours"},{"name":"compare-laptops","description":"Laptops","source":"zeno"},{"name":"old"}],"skillDrafts":[{"id":2,"jobId":1,"helper":"sid","name":"networking-basics","description":"Explaining networking.","preview":"1. Start simple.","state":"pending","createdAt":"x"},{"id":1,"jobId":9,"helper":"sid","name":"x","description":"d","preview":"p","state":"approved","createdAt":"x"},{"bad":true}],"skillEdits":[{"id":5,"skill":"compare-laptops","jobId":3,"reason":"Two was too few.","before":"2. Two.","after":"2. Three.","state":"pending","createdAt":"x"},{"id":4,"skill":"compare-laptops","jobId":3,"reason":"r","before":"a","after":"b","state":"accepted","createdAt":"x"}],"#)

    @Test func decodesDraftsEditsAndWhereEachSkillComesFrom() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        let list = try #require(state.list)
        #expect(list.skills.map(\.sourceTitle) == ["yours", "made by ZENO", "yours"], "an older runtime sends no source: Keshab's")
        #expect(list.skillDrafts.map(\.id) == [2, 1] && list.skillDrafts[0].preview == "1. Start simple.")
        #expect(list.skillEdits.map(\.state) == ["pending", "accepted"] && list.skillEdits[0].before == "2. Two.")
        var older = HelpersState()
        older.apply(try decodeEvent(HelperTaskTests.line))
        #expect(older.list?.skillDrafts.isEmpty == true && older.list?.skillEdits.isEmpty == true)
    }

    @Test func answersDraftsAndEditsAndMakesASkillFromADoneTask() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        #expect(state.answerSkillDraft(2, approve: true) == .skillApprove(id: 2))
        #expect(state.answerSkillDraft(2, approve: false) == .skillReject(id: 2))
        #expect(state.answerSkillDraft(1, approve: true) == nil) // answered already
        #expect(state.answerSkillEdit(5, accept: true) == .skillEditAccept(id: 5))
        #expect(state.answerSkillEdit(4, accept: false) == nil)
        #expect(state.undoSkillEdit(4) == .skillEditUndo(id: 4) && state.undoSkillEdit(5) == nil)
        _ = state.openThread(1)
        #expect(state.makeSkill() == nil, "task 1 has its draft already")
        _ = state.openThread(3)
        #expect(state.makeSkill() == nil, "a failed task does not become a skill")
        var other = HelpersState()
        other.apply(try decodeEvent(HelperTaskTests.line))
        _ = other.openThread(1)
        #expect(other.makeSkill() == .skillMake(id: 1))
        #expect(IslandCommand.skillEditUndo(id: 4).line == #"{"id":4,"type":"skill.edit.undo"}"# + "\n")
        #expect(IslandCommand.skillMake(id: 1).line == #"{"id":1,"type":"skill.make"}"# + "\n")
    }

    @Test func pendingDraftsAndEditsNeedYouAndAreNotifiedByNameOnly() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(Self.line))
        let list = try #require(state.list)
        let items = NeedsYouItem.all(in: list)
        #expect(items.map(\.kind) == [.skillDraft, .skillEdit, .failed])
        #expect(items[0].title == "New skill: networking-basics" && items[0].helperName == "Sid" && items[0].skillItemId == 2)
        #expect(items[1].title == "Edit to the compare-laptops skill" && items[1].detail == "Two was too few." && items[1].skillItemId == 5)
        var watcher = NoticeWatcher()
        _ = watcher.notices(for: HelpersList(helpers: list.helpers, apps: []))
        let notices = watcher.notices(for: list).filter { $0.key.hasPrefix("skill-") }
        #expect(notices.map(\.title) == ["Tinker drafted a skill: networking-basics", "Tinker suggests an edit to compare-laptops"])
        #expect(notices.allSatisfy { $0.kind == .needsYou && !$0.body.contains("Start simple") && !$0.body.contains("Three") })
    }
}

@Suite("Open in the worker's app (Task 3.14)")
struct HelperOpenTests {
    @Test func aFinishedReportOpensInItsWorkersApp() throws {
        let line = HelperTaskTests.line.replacingOccurrences(of: #""name":"Sid","available":true,"app":null"#, with: #""name":"Sid","available":true,"app":"Brave Browser""#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        _ = state.openThread(1)
        #expect(state.openTaskApp == nil) // the report has not come yet
        state.apply(.thread(HelperThread(id: 1, comments: [], activity: [], report: HelperReport(id: 1, title: "T", summary: "S", body: "B", sources: []))))
        #expect(state.openTaskApp == "Brave Browser")
        #expect(state.openReportInApp() == .jobOpen(id: 1))
        _ = state.openThread(5) // Hana has no app, and the task is queued
        #expect(state.openReportInApp() == nil)
        #expect(IslandCommand.jobOpen(id: 1).line == #"{"id":1,"type":"job.open"}"# + "\n")
    }
}

@Suite("Workers on screen (Task 3.15)")
struct WorkersOnScreenTests {
    @Test func aLineFromTheTeamShowsWhenIdle() throws {
        guard case .workerLine(let line) = try decodeEvent(#"{"type":"worker.line","line":"Your networking guide is ready. The ZENO window has the report."}"#) else {
            Issue.record("not a worker line"); return
        }
        var status = IslandStatus()
        status.apply(.workerLine(line))
        #expect(status.kind == .notice && status.title == "From the team" && status.detail.hasPrefix("Your networking guide"))
        #expect(throws: ProtocolError.self) { try decodeEvent(#"{"type":"worker.line"}"#) }
    }
}

@Suite("Paperclip connection (Task 3.16)")
struct PaperclipTests {
    @Test func paperclipTasksAreOnlyThereWhenTheConnectionIsOn() throws {
        guard case .helpers(let off) = try decodeEvent(HelperTaskTests.line) else { return }
        #expect(off.paperclip == nil)
        let on = HelperTaskTests.line.replacingOccurrences(of: #"{"type":"helpers","apps":[],"#,
            with: #"{"type":"helpers","apps":[],"paperclip":{"issues":[{"id":"is1","identifier":"PAP-1","title":"Review","agent":"CTO","status":"done","createdAt":"x","result":"Done."},{"id":2}]},"#)
        guard case .helpers(let list) = try decodeEvent(on) else { Issue.record("not helpers"); return }
        #expect(list.paperclip == [PaperclipTask(id: "is1", identifier: "PAP-1", title: "Review", agent: "CTO", status: "done", result: "Done.")])
        #expect(list.paperclip?.first?.isDone == true)
    }
}

@Suite("New agents (ADR-088)")
struct NewAgentTests {
    /// ADR-093: agent folders that could not be loaded arrive in `helpers`; absent means none, a malformed entry is left out.
    @Test func agentProblemsAreDecodedForTheBoard() throws {
        guard case .helpers(let none) = try decodeEvent(HelperTaskTests.line) else { Issue.record("not helpers"); return }
        #expect(none.agentProblems.isEmpty)
        let broken = HelperTaskTests.line.replacingOccurrences(of: #"{"type":"helpers","apps":[],"#,
            with: #"{"type":"helpers","apps":[],"agentProblems":[{"id":"bad","problem":"soul.md needs front matter (name, role, kit) between --- lines."},{"id":3},"x"],"#)
        guard case .helpers(let list) = try decodeEvent(broken) else { Issue.record("not helpers"); return }
        #expect(list.agentProblems == [AgentProblem(id: "bad", problem: "soul.md needs front matter (name, role, kit) between --- lines.")])
        #expect(list.agentProblems.first?.line == "bad: soul.md needs front matter (name, role, kit) between --- lines.")
    }

    @Test func createsAndRemovesAgents() throws {
        let line = HelperTaskTests.line.replacingOccurrences(of: #"{"id":"hana","name":"Hana","available":true,"app":null,"jobs""#,
            with: #"{"id":"rumi","name":"Rumi","available":true,"app":null,"role":"travel planner","kit":"think","custom":true,"jobs":[]},{"id":"hana","name":"Hana","available":true,"app":null,"jobs""#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        #expect(state.list?.helpers.first { $0.id == "rumi" }.map { $0.custom && $0.kit == "think" && !$0.worksInFolders } == true)
        #expect(state.removeAgent() == nil) // Sid is built in
        state.openNewAgent()
        #expect(state.isCreatingAgent)
        let soul = HelperSoul(name: " Mika ", personality: "Warm.", howItWorks: "", rules: "", lessons: "")
        #expect(state.createAgent(role: "", kit: "think", soul: soul) == nil && state.problem != nil)
        let command = state.createAgent(role: "Writer", kit: "folders", soul: soul)
        #expect(command == .agentCreate(name: "Mika", role: "Writer", kit: "folders", soul: soul.trimmed))
        let withMika = line.replacingOccurrences(of: #"{"id":"rumi""#, with: #"{"id":"mika","name":"Mika","available":true,"app":null,"role":"writer","kit":"folders","custom":true,"jobs":[]},{"id":"rumi""#)
        state.apply(try decodeEvent(withMika))
        #expect(!state.isCreatingAgent && state.selectedHelperId == "mika")
        #expect(state.removeAgent() == .agentRemove(id: "mika"))
    }
}

@Suite("Overview (ADR-090)")
struct TeamOverviewTests {
    @Test func countsWorkGoalsAndResults() throws {
        let line = HelperTaskTests.line
            .replacingOccurrences(of: #""id":5,"task":"Write the guide","state":"queued","#, with: #""id":5,"task":"Write the guide","state":"queued","goalId":7,"#)
            .replacingOccurrences(of: #""id":1,"task":"Research networking","state":"done","createdAt":"2026-10-10T06:00:00Z","#,
                                  with: #""id":1,"task":"Research networking","state":"done","createdAt":"2026-10-10T06:00:00Z","endedAt":"2026-10-10T07:00:00Z","goalId":7,"#)
        guard case .helpers(let list) = try decodeEvent(line) else { Issue.record("not helpers"); return }
        let now = ISO8601DateFormatter().date(from: "2026-10-10T12:00:00Z")!
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let o = TeamOverview(list: list, now: now, calendar: utc)
        #expect(o.atWork.map(\.id) == [2] && o.running == 1)
        #expect(o.needsYou == 1 && o.toDo == 2)
        #expect(o.recent.map(\.id) == [1] && o.doneToday == 1)
        #expect(o.goals.count == 1)
        let goal = try #require(o.goals.first)
        #expect(goal.id == 7 && goal.total == 2 && goal.done == 1 && !goal.ended && goal.fraction == 0.5)
        #expect(goal.text == "A networking guide")
    }
}

@Suite("Needs you (ADR-090)")
struct NeedsYouTests {
    @Test func gathersPlansProposalsHoldsAndFailures() throws {
        let line = HelperTaskTests.line
            .replacingOccurrences(of: #""name":"Sid","available":true,"app":null,"jobs""#,
                                  with: #""name":"Sid","available":true,"app":null,"proposals":[{"id":4,"field":"lessons","text":"Three sources.","reason":"Thin.","jobId":1,"state":"pending","createdAt":"x"}],"jobs""#)
            .replacingOccurrences(of: #""id":6,"task":"Then this","state":"queued","#, with: #""id":6,"task":"Then this","state":"queued","planStatus":"awaiting","planSummary":"Search, then compare.","#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        let items = NeedsYouItem.all(in: try #require(state.list))
        #expect(items.map(\.kind) == [.plan, .proposal, .failed])
        #expect(items[0].jobId == 6 && items[0].detail == "Search, then compare.")
        #expect(items[2].detail == "x" && items[2].jobId == 3)
        #expect(state.answerPlan(6, approve: true) == .planApprove(id: 6))
        #expect(state.answerPlan(5, approve: true) == nil) // no plan waits there
        #expect(state.answerProposal(helper: "sid", id: 4, accept: false) == .proposalReject(id: 4))
        #expect(state.answerProposal(helper: "hana", id: 4, accept: true) == nil)
    }
}

@Suite("Issues (ADR-090)")
struct IssuesTests {
    @Test func listsFailuresAndRetriesThem() throws {
        let line = HelperTaskTests.line.replacingOccurrences(of: #""error":"x","#, with: #""error":"x","autoRetries":1,"#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        let issues = TeamIssues.all(in: try #require(state.list))
        #expect(issues.map(\.id) == [3] && issues[0].job.autoRetries == 1)
        #expect(state.retry(3) == .jobRetry(id: 3))
        #expect(state.retry(4) == .jobRetry(id: 4)) // stopped
        #expect(state.retry(1) == nil) // done
        #expect(TaskActivity(kind: "retried", at: nil).title == "Tried again")
        #expect(IslandCommand.jobRetry(id: 3).line == #"{"id":3,"type":"job.retry"}"# + "\n")
    }
}

@Suite("Plugins and MCP servers (ADR-090)")
struct McpTests {
    @Test func decodesServersAndAsksForChanges() throws {
        let line = HelperTaskTests.line.replacingOccurrences(of: #"{"type":"helpers","apps":[],"#,
            with: #"{"type":"helpers","apps":[],"mcp":[{"id":2,"name":"notes","kind":"command","command":"notes-mcp","args":[],"transport":"http","envKeys":["NOTES_TOKEN"],"headerKeys":[],"enabled":false,"trusted":false,"workers":[],"tools":["search"],"testedAt":"2026-10-11T00:00:00Z"},{"bad":1}],"#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        let server = try #require(state.list?.mcp.first)
        #expect(state.list?.mcp.count == 1 && server.canTurnOn && server.envKeys == ["NOTES_TOKEN"] && server.tools == ["search"])
        var empty = McpServerDraft()
        empty.name = "x"
        #expect(state.addMcp(empty) == nil && state.problem != nil)
        var draft = McpServerDraft()
        draft.name = "notes2"
        draft.command = "notes-mcp"
        draft.args = "--stdio\n\n -v "
        draft.env = "T=1"
        let added = state.addMcp(draft)
        let command = try #require(added)
        #expect(command.line.contains(#""args":["--stdio","-v"]"#) && command.line.contains(#""env":["T=1"]"#) && command.line.contains(#""type":"mcp.add""#))
        #expect(IslandCommand.mcpSet(id: 2, enabled: true, trusted: nil, workers: ["sid"]).line == #"{"enabled":true,"id":2,"type":"mcp.set","workers":["sid"]}"# + "\n")
        #expect(IslandCommand.mcpTest(id: 2).line == #"{"id":2,"type":"mcp.test"}"# + "\n")
    }
}

@Suite("Office floor (ADR-090)")
struct OfficePlanTests {
    @Test func palsSitAtDesksOrRestInTheLoungeAndEnvelopesTravel() {
        let now = Date()
        var running = HelperJob(id: 1, task: "t", state: .running)
        running.step = "Reading 3 of 8 pages"
        var awaiting = HelperJob(id: 2, task: "t", state: .queued)
        awaiting.planStatus = "awaiting"
        var sub = HelperJob(id: 3, task: "t", state: .queued)
        sub.parentId = 1
        var won = HelperJob(id: 4, task: "t", state: .done)
        won.goalEnded = true
        won.endedAt = now.addingTimeInterval(-10)
        let failed = HelperJob(id: 5, task: "t", state: .failed)
        let list = HelpersList(helpers: [
            Helper(id: "sid", name: "Sid", available: true, app: nil, jobs: [running]),
            Helper(id: "kame", name: "Kame", available: true, app: nil, jobs: [awaiting]),
            Helper(id: "puff", name: "Puff", available: true, app: nil, jobs: [sub]),
            Helper(id: "quill", name: "Quill", available: true, app: nil, jobs: [won]),
            Helper(id: "penny", name: "Penny", available: true, app: nil, jobs: [failed]),
            Helper(id: "gone", name: "Gone", available: false, app: nil, jobs: []),
        ], apps: [])
        let plan = OfficePlan(list: list, now: now)
        let by = Dictionary(uniqueKeysWithValues: plan.seats.map { ($0.helperId, $0) })
        #expect(plan.seats.count == 5, "an unavailable worker with no tasks is not on the floor")
        #expect(by["sid"]?.spot == .desk(0) && by["sid"]?.animation == "working" && by["sid"]?.bubble == "Reading 3 of 8 pages" && by["sid"]?.taskId == 1)
        // Only the worker at work is at a PC; waiting, queued, celebrating and failed ones are in the lounge.
        #expect(by["kame"]?.spot == .lounge(0) && by["kame"]?.flag == .needsYou && by["kame"]?.bubble == "Waiting for your OK")
        #expect(by["puff"]?.spot == .lounge(1) && by["puff"]?.animation == "idle")
        #expect(by["quill"]?.spot == .lounge(2) && by["quill"]?.animation == "celebrate")
        #expect(by["penny"]?.spot == .lounge(3) && by["penny"]?.animation == "sad" && by["penny"]?.flag == .failed)
        #expect(plan.seats.filter { if case .desk = $0.spot { return true } else { return false } }.map(\.helperId) == ["sid"])
        #expect(plan.envelopes == [OfficePlan.Envelope(from: "sid", to: "puff", taskId: 3)])
        // A minute later the celebration is over.
        #expect(OfficePlan(list: list, now: now.addingTimeInterval(OfficePlan.celebration)).seats.first { $0.helperId == "quill" }?.animation == "idle")
    }
}

@Suite("Notifications (ADR-091)")
struct NoticeTests {
    func list(_ jobs: [HelperJob], spent: Double = 0, team: Double = 0) -> HelpersList {
        HelpersList(helpers: [Helper(id: "sid", name: "Sid", available: true, app: nil, jobs: jobs, budget: HelperBudget(cap: 5, spent: spent))],
                    apps: [], team: HelperBudget(cap: 10, spent: team), planLimit: 80)
    }

    @Test func onlyWhatIsNewIsNotifiedNeverThePast() {
        var watcher = NoticeWatcher()
        var old = HelperJob(id: 1, task: "t", state: .done)
        old.title = "Old report"
        #expect(watcher.notices(for: list([old])).isEmpty, "the first list only learns")
        var running = HelperJob(id: 2, task: "secret task text", state: .running)
        #expect(watcher.notices(for: list([old, running])).isEmpty)
        running.state = .done
        running.title = "Networking basics"
        let done = watcher.notices(for: list([old, running]))
        #expect(done.map(\.kind) == [.done] && done[0].title == "Sid finished" && done[0].body == "Networking basics" && done[0].taskId == 2)
        #expect(!done[0].body.contains("secret"), "never the task's own text")
        #expect(watcher.notices(for: list([old, running])).isEmpty, "each once")
        var failed = HelperJob(id: 3, task: "t", state: .failed)
        failed.error = "The pages would not load\nmore detail"
        var plan = HelperJob(id: 4, task: "t", state: .queued)
        plan.planStatus = "awaiting"
        var held = HelperJob(id: 5, task: "t", state: .queued)
        held.held = "The team's budget is used up."
        let next = watcher.notices(for: list([old, running, failed, plan, held]))
        #expect(next.map(\.kind) == [.failed, .needsYou, .needsYou])
        #expect(next[0].body == "The pages would not load")
    }

    @Test func budgetsAndThePlanWarnAt80AndWhenFullAgainAfterTheyReset() {
        var watcher = NoticeWatcher()
        _ = watcher.notices(for: list([], spent: 1))
        let warn = watcher.notices(for: list([], spent: 4.1))
        #expect(warn.map(\.title) == ["Sid's budget is 82% used"] && warn[0].body == "$4.10 of $5.00 today")
        #expect(watcher.notices(for: list([], spent: 5, team: 10)).map(\.title) == ["Sid's budget is used up", "The team's budget is used up"])
        _ = watcher.notices(for: list([], spent: 0))
        #expect(watcher.notices(for: list([], spent: 4.5)).count == 1, "a new day warns again")
        let plan = watcher.notices(for: list([], spent: 4.5), plan: PlanUsage(fiveHour: 0.86))
        #expect(plan.map(\.title) == ["The Claude plan is at 86%"] && plan[0].body.contains("wait above 80%"))
    }
}

@Suite("Dashboard tokens (ADR-091)")
struct TokenUsageTests {
    @Test func decodesUsageAndShortensNumbers() throws {
        let line = HelperTaskTests.line.replacingOccurrences(of: #"{"type":"helpers","apps":[],"#,
            with: #"{"type":"helpers","apps":[],"usage":{"today":{"input":10,"output":5,"cacheRead":100,"cacheWrite":2,"dollars":0.5,"runs":1},"week":{"input":10,"output":5,"cacheRead":100,"cacheWrite":2,"dollars":0.5,"runs":1},"days":[{"day":"2026-10-11","input":10,"output":5,"cacheRead":100,"cacheWrite":2,"dollars":0.5,"runs":1}],"byWorker":[{"helper":null,"name":"ZENO chat","input":10,"output":5,"cacheRead":100,"cacheWrite":2,"dollars":0.5,"runs":1}],"byModel":[{"model":"claude-sonnet-5-5","input":1,"output":0,"cacheRead":0,"cacheWrite":0,"dollars":0,"runs":1},{"bad":1}]},"#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        let usage = try #require(state.list?.usage)
        #expect(usage.today.total == 117 && usage.today.fresh == 17 && usage.days.first?.day == "2026-10-11")
        #expect(usage.byWorker.first?.helper == nil && usage.byWorker.first?.name == "ZENO chat" && usage.byModel.map(\.model) == ["claude-sonnet-5-5"])
        #expect([TokenTotals.short(850), TokenTotals.short(1240), TokenTotals.short(12_400), TokenTotals.short(3_100_000)] == ["850", "1.2K", "12K", "3.1M"])
    }
}

@Suite("Chats (ADR-091)")
struct ChatTests {
    @Test func decodesChatsAndReplaysAnOpenedChat() throws {
        guard case .chats(let list) = try decodeEvent(#"{"type":"chats","current":"a","chats":[{"id":"a","title":"Plan my trip","updatedAt":"2026-10-11T00:00:00.000Z","messages":4},{"bad":1}]}"#) else {
            Issue.record("not chats"); return
        }
        #expect(list.current == "a" && list.chats.map(\.title) == ["Plan my trip"] && list.chats[0].updatedAt != nil && list.chats[0].messages == 4)
        var conversation = Conversation()
        conversation.apply(.transcript("unrelated"))
        conversation.apply(try decodeEvent(#"{"type":"chat.opened","id":"a","messages":[{"role":"user","text":"Plan my trip"},{"role":"assistant","text":"Where to?"},{"role":"user","text":"Tokyo"}]}"#))
        #expect(conversation.turns.map(\.transcript) == ["Plan my trip", "Tokyo"])
        #expect(conversation.turns.map(\.reply) == ["Where to?", nil] && conversation.turns.allSatisfy { $0.outcome == .answered })
        #expect(IslandCommand.chatOpen(id: "a").line == #"{"id":"a","type":"chat.open"}"# + "\n" && IslandCommand.chatsList.line == #"{"type":"chats.list"}"# + "\n")
    }
}

@Suite("Read-only chats (ADR-098)")
struct ReadOnlyChatTests {
    @Test func decodesTheFlagAndDefaultsToFalse() throws {
        guard case .chats(let list) = try decodeEvent(#"{"type":"chats","current":"telegram","chats":[{"id":"telegram","title":"Telegram","updatedAt":"2026-10-11T00:00:00.000Z","messages":4,"readOnly":true},{"id":"api-ci","title":"api-ci","updatedAt":"2026-10-11T00:00:00.000Z","messages":1,"readOnly":true},{"id":"a","title":"Plan","updatedAt":"2026-10-11T00:00:00.000Z","messages":2}]}"#) else {
            Issue.record("not chats"); return
        }
        #expect(list.chats.map(\.readOnly) == [true, true, false])
    }

    @Test func theComposerIsOffOnlyInAReadOnlyChatWithTheRightLine() {
        let chats = [ChatInfo(id: "telegram", title: "Telegram", readOnly: true), ChatInfo(id: "api", title: "api", readOnly: true), ChatInfo(id: "a", title: "Plan")]
        #expect(ChatList(chats: chats, current: "telegram").currentReadOnlyNotice == "Written from Telegram. You can read it here.")
        #expect(ChatList(chats: chats, current: "api").currentReadOnlyNotice == "Written from the local API. You can read it here.")
        #expect(ChatList(chats: chats, current: "a").currentReadOnlyNotice == nil)
        #expect(ChatList(chats: chats, current: "unknown").currentReadOnlyNotice == nil)
    }
}

@Suite("Git branches (ADR-091)")
struct GitBranchTests {
    @Test func decodesBranchesAndKnowsWhenOneCanBePushed() throws {
        let event = try decodeEvent(#"{"type":"git","branches":[{"repo":"/r","repoName":"r","branch":"zeno/task-7","task":7,"title":"Notes","base":"origin/main","commits":[{"sha":"abc1234","subject":"ZENO task 7","at":"2026-10-11T00:00:00+09:00"}],"files":[{"path":"a.md","added":2,"removed":1},{"path":"b.png","added":null,"removed":null}],"remote":"git@github.com:k/r.git","pushed":"no"},{"bad":1}]}"#)
        var state = HelpersState()
        state.apply(event)
        let b = try #require(state.git?.first)
        #expect(state.git?.count == 1 && b.task == 7 && b.title == "Notes" && b.commits.first?.at != nil)
        #expect(b.files.map(\.added) == [2, nil] && b.added == 2 && b.removed == 1 && b.canPush)
        var pushed = b
        pushed.pushed = .yes
        var noRemote = b
        noRemote.remote = nil
        #expect(!pushed.canPush && !noRemote.canPush)
        #expect(IslandCommand.gitPush(repo: "/r", branch: "zeno/task-7").line == #"{"branch":"zeno/task-7","repo":"/r","type":"git.push"}"# + "\n")
    }
}

@Suite("Sub-agents (ADR-095)")
struct SubAgentTests {
    @Test func decodesTheOpenTasksSubAgentsAndTheirLines() throws {
        let line = HelperTaskTests.line.replacingOccurrences(
            of: #""id":2,"task":"Research IPv6","state":"running","#,
            with: #""id":2,"task":"Research IPv6","state":"running","subAgents":[{"name":"searcher","state":"done","description":"Find RFCs","result":"Three pages."},{"name":"reader","state":"started","description":"Read them"},{"name":"bad","state":"lost"},{"state":"done"},{"name":"checker","state":"failed","description":""}],"#)
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        #expect(state.openThread(2) == .threadGet(id: 2))
        let agents = try #require(state.openJob?.subAgents)
        #expect(agents.map(\.name) == ["searcher", "reader", "checker"]) // a malformed one is left out
        #expect(agents.map(\.stateTitle) == ["Done", "Working", "Failed"])
        #expect(agents.map(\.detail) == ["Three pages.", "Read them", nil]) // the result once it has one
        #expect(state.list?.item(1)?.job.subAgents == []) // none: an older runtime, or none started
    }

    @Test func aChangedSubAgentAsksForTheOpenThreadAgain() throws {
        var state = HelpersState()
        state.apply(try decodeEvent(HelperTaskTests.line))
        _ = state.openThread(2)
        _ = state.takeRefresh()
        let started = HelperTaskTests.line.replacingOccurrences(of: #""id":2,"task":"Research IPv6","state":"running","#,
                                                                with: #""id":2,"task":"Research IPv6","state":"running","subAgents":[{"name":"reader","state":"started","description":"d"}],"#)
        state.apply(try decodeEvent(started))
        #expect(state.takeRefresh() == .threadGet(id: 2))
        #expect(state.openJob?.subAgents == [HelperSubAgent(name: "reader", state: .started, description: "d")])
    }
}
