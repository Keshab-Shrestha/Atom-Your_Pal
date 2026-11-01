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
}
