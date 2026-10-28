import Foundation
import Testing
@testable import AtomIslandCore

/// The Dashboard's tabbed Trends panel and its Recent turns bars (from the HTML preview).
struct DashboardTrendsTests {
    private func run(_ kind: RecentTokens.Kind = .turn, model: String = "claude-sonnet-5-5", input: Int, output: Int, read: Int = 0, write: Int = 0) -> RecentTokens {
        RecentTokens(kind: kind, model: model, input: input, output: output, cacheRead: read, cacheWrite: write)
    }

    @Test func theTabsReadTokensCacheReuseRuns() {
        #expect(DashboardTrendKind.allCases.map(\.title) == ["Tokens", "Cache reuse", "Runs"])
        #expect(DashboardTrendKind.allCases.map(\.detail) == ["Input + output · 7 days", "Cached input · 7 days", "Recorded calls · 7 days"])
    }

    @Test func barsKeepTheNewestSixInOrder() {
        let runs = (1...9).map { run(input: $0 * 100, output: 0) }
        let bars = RecentTurnBar.bars(runs)
        #expect(bars.count == 6)
        #expect(bars.first?.tokensText == "100", "the order of the runs is kept; the first six are shown")
        #expect(RecentTurnBar.bars(runs, limit: 2).count == 2)
        #expect(RecentTurnBar.bars([]).isEmpty)
    }

    @Test func barLengthsCompareToTheLargestRun() {
        let bars = RecentTurnBar.bars([run(input: 600, output: 400), run(input: 100, output: 100)])
        #expect(bars[0].inputShare == 0.6 && bars[0].outputShare == 0.4)
        #expect(bars[1].inputShare == 0.1 && bars[1].outputShare == 0.1)
    }

    @Test func aRunWithNoTokensDrawsNoBar() {
        let bars = RecentTurnBar.bars([run(input: 0, output: 0), run(input: 0, output: 0)])
        #expect(bars.allSatisfy { $0.inputShare == 0 && $0.outputShare == 0 })
    }

    @Test func theRowNamesTokensAndHowMuchCameFromTheCache() {
        let bar = RecentTurnBar.bars([run(input: 20, output: 3_280, read: 990, write: 0)])[0]
        #expect(bar.tokensText == "3.3K")
        #expect(bar.cachedText == "98% cached", "cache read share of the prompt: 990 of 1010")
        #expect(bar.model == "claude-sonnet-5-5")
        #expect(bar.kindTitle == run(input: 0, output: 0).kindTitle && !bar.kindTitle.isEmpty)
        #expect(RecentTurnBar.bars([run(input: 50, output: 10)])[0].cachedText == "0% cached")
        #expect(RecentTurnBar.bars([run(input: 0, output: 10)])[0].cachedText == "No prompt tokens", "no prompt tokens, no share")
    }
}
