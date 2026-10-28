import Foundation
import Testing
@testable import AtomIslandCore

/// The Dashboard's Usage view in the Recent turns panel (from the HTML preview): the week's accounting in one place.
struct UsageDetailsFactsTests {
    private func totals(_ input: Int, _ output: Int = 0, read: Int = 0, write: Int = 0, dollars: Double = 0) -> TokenTotals {
        TokenTotals(input: input, output: output, cacheRead: read, cacheWrite: write, dollars: dollars)
    }

    private func summary(workers: [(String, TokenTotals)] = [], models: [(String, TokenTotals)] = []) -> TokenUsageSummary {
        TokenUsageSummary(
            today: TokenTotals(),
            week: totals(19_000, 7_600, read: 1_400_000, write: 290_000, dollars: 3.1),
            byWorker: workers.map { WorkerTokens(helper: nil, name: $0.0, totals: $0.1) },
            byModel: models.map { ModelTokens(model: $0.0, totals: $0.1) })
    }

    @Test func theWeekHasDollarsAndBothCacheFigures() {
        let facts = UsageDetailsFacts(summary: summary())
        #expect(facts.apiEquivalentText == "$3.10")
        #expect(facts.cacheWrittenText == "290K" && facts.cacheReadText == "1.4M")
    }

    @Test func rowsAreSharesOfTheWeekLargestFirst() {
        let facts = UsageDetailsFacts(summary: summary(models: [
            ("claude-haiku-5-5", totals(240_000)), ("claude-sonnet-5-5", totals(1_100_000)), ("gpt-6-luna", totals(380_000)),
        ]))
        #expect(facts.models.map(\.name) == ["claude-sonnet-5-5", "gpt-6-luna", "claude-haiku-5-5"])
        #expect(facts.models.map(\.tokensText) == ["1.1M", "380K", "240K"])
        // Shares are of the week total (1,716,600), the same total the Token mix uses.
        #expect(facts.models[0].percentText == "64%" && facts.models[2].percentText == "14%")
        #expect(abs(facts.models[0].share - 1_100_000.0 / 1_716_600.0) < 0.0001)
    }

    @Test func atMostFiveRowsShowAndTheRestAreCounted() {
        let workers = (1...8).map { ("w\($0)", totals($0 * 1_000)) }
        let facts = UsageDetailsFacts(summary: summary(workers: workers))
        #expect(facts.workers.count == 5 && facts.workers.first?.name == "w8")
        #expect(facts.moreWorkers == 3 && facts.moreModels == 0)
    }

    @Test func aRowWithNoTokensStillHasAZeroShare() {
        let facts = UsageDetailsFacts(summary: summary(workers: [("Idle", totals(0))]))
        #expect(facts.workers[0].share == 0 && facts.workers[0].percentText == "0%" && facts.workers[0].tokensText == "0")
    }

    @Test func noWeekTotalMeansNoShares() {
        let empty = TokenUsageSummary(today: TokenTotals(), week: TokenTotals(),
                                      byWorker: [WorkerTokens(helper: nil, name: "A", totals: totals(5))])
        #expect(UsageDetailsFacts(summary: empty).workers[0].share == 0, "no total, no division by zero")
    }
}
