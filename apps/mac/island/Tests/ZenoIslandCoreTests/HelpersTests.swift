import Foundation
import Testing
@testable import ZenoIslandCore

@Suite("Helpers protocol (ADR-081)")
struct HelpersProtocolTests {
    func fields(_ command: IslandCommand) throws -> [String: Any] {
        let line = command.line
        #expect(line.hasSuffix("\n"))
        #expect(!line.dropLast().contains("\n"))
        return try #require(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
    }

    @Test func encodesTheSixCommands() throws {
        #expect(IslandCommand.helpersList.line == #"{"type":"helpers.list"}"# + "\n")
        #expect(IslandCommand.helperSet(helper: "sid", app: "Brave Browser").line
            == #"{"app":"Brave Browser","helper":"sid","type":"helper.set"}"# + "\n")
        #expect(IslandCommand.helperSet(helper: "sid", app: "").line == #"{"app":"","helper":"sid","type":"helper.set"}"# + "\n")
        #expect(IslandCommand.jobStop(id: 12).line == #"{"id":12,"type":"job.stop"}"# + "\n") // a number, not "12"
        #expect(IslandCommand.jobDelete(id: 12).line == #"{"id":12,"type":"job.delete"}"# + "\n")
        #expect(IslandCommand.reportGet(id: 3).line == #"{"id":3,"type":"report.get"}"# + "\n")
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

    @Test func decodesAReportKeepingOnlyWebSources() throws {
        let line = #"{"type":"report","id":1,"title":"Networking basics","summary":"How packets travel.","body":"First.\n\nSecond.\n\n\n","sources":[{"title":"RFC 791","url":"https://www.rfc-editor.org/rfc/rfc791"},{"title":"Old","url":"http://example.com/a"},{"title":"Script","url":"javascript:alert(1)"},{"title":"File","url":"file:///etc/passwd"}]}"#
        guard case .report(let report) = try decodeEvent(line) else { Issue.record("not a report"); return }
        #expect(report.id == 1 && report.title == "Networking basics" && report.summary == "How packets travel.")
        #expect(report.paragraphs == ["First.", "Second."])
        #expect(report.sources.map(\.title) == ["RFC 791", "Old"])
        #expect(report.sources[0].url.absoluteString == "https://www.rfc-editor.org/rfc/rfc791")
    }

    @Test func rejectsMalformedReports() {
        let cases: [(String, ProtocolError)] = [
            (#"{"type":"report","title":"t","summary":"s","body":"b","sources":[]}"#, .missingField(event: "report", field: "id")),
            (#"{"type":"report","id":1,"title":"t","summary":"s","sources":[]}"#, .missingField(event: "report", field: "body")),
            (#"{"type":"report","id":1,"title":"t","summary":"s","body":"b"}"#, .missingField(event: "report", field: "sources")),
            (#"{"type":"report","id":1,"title":"t","summary":"s","body":"b","sources":"x"}"#, .invalidValue(event: "report", field: "sources")),
            (#"{"type":"report","id":1,"title":"t","summary":"s","body":"b","sources":[{"title":"t"}]}"#,
             .invalidValue(event: "report", field: "sources")),
            (#"{"type":"report","id":true,"title":"t","summary":"s","body":"b","sources":[]}"#, .invalidValue(event: "report", field: "id")),
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

@Suite("Helpers window state (ADR-081)")
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

@Suite("Goals Wisp hands out (Task 3.5)")
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
