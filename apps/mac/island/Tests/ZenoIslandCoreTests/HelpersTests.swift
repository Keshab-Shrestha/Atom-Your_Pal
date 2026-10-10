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

    @Test func openingAReportAsksForItAndKeepsOnlyItsAnswer() throws {
        var state = try loaded()
        #expect(state.openReport(0) == nil) // failed, no report
        #expect(state.openReport(1) == .reportGet(id: 1))
        #expect(state.openJob?.id == 1 && state.report == nil)
        let other = HelperReport(id: 7, title: "x", summary: "y", body: "z", sources: [])
        state.apply(.report(other))
        #expect(state.report == nil) // not the open job's
        let mine = HelperReport(id: 1, title: "Networking basics", summary: "s", body: "b", sources: [])
        state.apply(.report(mine))
        #expect(state.report == mine)
        state.closeReport()
        #expect(state.report == nil && state.openJobId == nil)
    }

    @Test func aDeletedJobClosesItsReport() throws {
        var state = try loaded()
        _ = state.openReport(1)
        state.apply(.report(HelperReport(id: 1, title: "t", summary: "s", body: "b", sources: [])))
        #expect(state.deleteJob(1) == .jobDelete(id: 1))
        #expect(state.report == nil && state.openJobId == nil)
        // Deleted elsewhere (by voice, another window): the next list closes it too.
        _ = state.openReport(1)
        let without = HelpersProtocolTests.helpersLine.replacingOccurrences(of: #""partial":true,"title":"Networking basics","#, with: "")
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
