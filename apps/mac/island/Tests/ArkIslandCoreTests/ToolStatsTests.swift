import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Stats page (2026-11-05)") struct ToolStatsTests {
    @Test func theEventDecodesAndAMalformedRowIsLeftOut() throws {
        let event = try decodeEvent(#"{"type":"stats","days":7,"turns":4,"avgTurnMs":1500,"slowTurns":1,"totalCalls":10,"totalFailed":2,"tools":[{"name":"computer","calls":8,"failed":2,"avgMs":120,"repeats":1},{"calls":1},{"name":"","calls":2}]}"#)
        guard case .stats(let stats) = event else { Issue.record("not a stats event"); return }
        #expect(stats.tools == [ToolStatRow(name: "computer", calls: 8, failed: 2, avgMs: 120, repeats: 1)])
        #expect(stats.turns == 4 && stats.slowTurns == 1 && stats.totalFailed == 2 && !stats.isEmpty)
    }

    @Test func wordsForFailuresAndTimes() {
        #expect(ToolStatRow(name: "a", calls: 8, failed: 0, avgMs: 0, repeats: 0).failureText == "0 failed")
        #expect(ToolStatRow(name: "a", calls: 8, failed: 2, avgMs: 0, repeats: 0).failureText == "2 failed (25%)")
        #expect(ToolStats.duration(120) == "120 ms")
        #expect(ToolStats.duration(1500) == "1.5 s")
        #expect(ToolStats.duration(120_000) == "2 min")
    }

    @Test func anEmptyEventIsEmptyAndTheCommandIsOneLine() throws {
        guard case .stats(let stats) = try decodeEvent(#"{"type":"stats"}"#) else { Issue.record("not a stats event"); return }
        #expect(stats.isEmpty && stats.tools.isEmpty && stats.days == 1)
        #expect(IslandCommand.statsGet.type == "stats.get")
    }
}
