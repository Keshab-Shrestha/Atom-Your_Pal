import Foundation
import Testing
@testable import ArkIslandCore

struct TraceWaterfallTests {
    private let t0 = Date(timeIntervalSince1970: 1_000_000)

    private func call(_ id: String, at: Double, ms: Int?, state: HelperToolCall.State = .ok, agent: String? = nil) -> HelperToolCall {
        HelperToolCall(id: id, agent: agent, tool: "Read", input: "x", state: state, at: t0.addingTimeInterval(at), durationMs: ms)
    }

    @Test func barsShareOneAxisAndSubAgentsGroup() {
        let calls = [call("b", at: 2, ms: 3000, agent: "searcher"), call("a", at: 0, ms: 1000), call("c", at: 4, ms: 500, state: .error, agent: "searcher")]
        let w = TraceWaterfall(calls: calls, now: t0.addingTimeInterval(10))
        #expect(w.rows.map(\.id) == ["a", "group:searcher", "b", "c"], "main agent first, then each sub-agent's group")
        #expect(w.rows[1].start == 2 && w.rows[1].length == 3, "a group spans its calls: 2 s to 5 s")
        #expect(w.rows[2].indented && !w.rows[0].indented)
        #expect(w.duration == 5 && w.calls == 3 && w.errors == 1 && w.subAgents == 1)
        #expect(w.slowest == "b")
        #expect(!w.running)
    }

    @Test func aRunningCallGrowsToNow() {
        let w = TraceWaterfall(calls: [call("a", at: 0, ms: 1000), call("r", at: 1, ms: nil, state: .started)], now: t0.addingTimeInterval(7))
        #expect(w.rows[1].length == 6 && w.rows[1].running && w.running)
        #expect(w.duration == 7)
        #expect(w.slowest == nil, "one finished call: nothing to compare")
    }

    @Test func emptyAndTicks() {
        let w = TraceWaterfall(calls: [])
        #expect(w.rows.isEmpty && w.duration == 0)
        #expect(TraceWaterfall.ticks(duration: 14) == [0, 5, 10])
        #expect(TraceWaterfall.ticks(duration: 0.4) == [0, 1])
        #expect(TraceWaterfall.ticks(duration: 200) == [0, 60, 120, 180])
    }

    @Test func flowCardClock() {
        var job = HelperJob(id: 1, task: "t", state: .running)
        #expect(job.clockText(now: t0) == nil, "undated")
        job.createdAt = t0
        #expect(job.clockText(now: t0.addingTimeInterval(222)) == "3m 42s", "running: since it was given")
        job.state = .done
        job.endedAt = t0.addingTimeInterval(252)
        #expect(job.clockText(now: t0.addingTimeInterval(9999)) == "4m 12s", "ended: how long it took")
        job.endedAt = nil
        #expect(job.clockText(now: t0) == nil, "ended with no end time: nothing, not 0s")
    }
}
