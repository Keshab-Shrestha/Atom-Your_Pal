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
        state.selectHelper("kame") // coming soon: not selectable
        #expect(state.selectedHelperId == "sid")
        state.selectHelper("nobody")
        #expect(state.selectedHelperId == "sid")
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
