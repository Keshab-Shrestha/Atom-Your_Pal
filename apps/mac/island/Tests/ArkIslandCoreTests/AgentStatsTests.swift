import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Agent stats")
struct AgentStatsTests {
    private func job(_ id: Int, _ state: JobState, seconds: Double) -> HelperJob {
        let start = Date(timeIntervalSince1970: 1_000)
        return HelperJob(id: id, task: "t", state: state, createdAt: start, endedAt: start.addingTimeInterval(seconds))
    }

    @Test func runsShareAndTypicalTime() {
        let stats = AgentStats(jobs: [job(1, .done, seconds: 30), job(2, .done, seconds: 90), job(3, .failed, seconds: 5), job(4, .running, seconds: 0), job(5, .done, seconds: 50)])
        #expect(stats.runs == 4, "running and queued work is not a run yet")
        #expect(stats.line == "4 runs · 75% done · 50s typical")
        #expect(AgentStats(jobs: [job(1, .done, seconds: 125)]).line == "1 run · 100% done · 2m 5s typical")
        #expect(AgentStats(jobs: []).line == nil)
    }

    @Test func aBranchSaysHowMuchItChanged() throws {
        let event = try decodeEvent(#"{"type":"git","branches":[{"repo":"/r","branch":"ark/task-7","task":7,"base":"main","files":[{"path":"a.md","added":10,"removed":2},{"path":"b.md","added":2,"removed":1},{"path":"c.png","added":null,"removed":null}]}]}"#)
        guard case .git(let branches) = event else { Issue.record("not a git event"); return }
        #expect(branches.first?.changeLine == "+12 \u{2212}3 · 3 files")
    }

    @Test func usageHistoryDecodesForTheRangeSwitch() throws {
        let totals = #""input":1,"output":2,"cacheRead":3,"cacheWrite":4,"dollars":0.1,"runs":1"#
        let line = #"{"type":"helpers","apps":[],"helpers":[],"usage":{"today":{"# + totals + #"},"week":{"# + totals + #"},"days":[],"history":[{"day":"2026-09-01","# + totals + #"},{"day":"2026-11-01","# + totals + #"}]}}"#
        guard case .helpers(let list) = try decodeEvent(line) else { Issue.record("not a helpers event"); return }
        #expect(list.usage?.history.map(\.day) == ["2026-09-01", "2026-11-01"])
    }
}
