import Foundation

/// What the Dashboard's Usage view says about the week (from the HTML preview): the API-equivalent dollars, the cache
/// figures, and who and which model used how much. Shares are of the week's total tokens, as in the Token mix.
public struct UsageDetailsFacts: Equatable, Sendable {
    public struct Row: Equatable, Sendable {
        public let name: String
        public let tokensText: String
        public let percentText: String
        /// 0...1 of the week's total.
        public let share: Double
    }

    public static let rowLimit = 5

    public let apiEquivalentText: String
    public let cacheWrittenText: String
    public let cacheReadText: String
    public let workers: [Row]
    public let models: [Row]
    public let moreWorkers: Int
    public let moreModels: Int

    public init(summary: TokenUsageSummary) {
        let total = summary.week.total
        func rows(_ items: [(String, TokenTotals)]) -> (shown: [Row], more: Int) {
            let sorted = items.sorted { $0.1.total > $1.1.total }
            let shown = sorted.prefix(Self.rowLimit).map { name, totals in
                Row(name: name, tokensText: TokenTotals.short(totals.total),
                    percentText: TokenTotals.sharePercent(totals.total, of: total),
                    share: total > 0 ? min(1, Double(totals.total) / Double(total)) : 0)
            }
            return (Array(shown), max(0, sorted.count - Self.rowLimit))
        }
        apiEquivalentText = String(format: "$%.2f", summary.week.dollars)
        cacheWrittenText = TokenTotals.short(summary.week.cacheWrite)
        cacheReadText = TokenTotals.short(summary.week.cacheRead)
        let workers = rows(summary.byWorker.map { ($0.name, $0.totals) })
        let models = rows(summary.byModel.map { ($0.model, $0.totals) })
        self.workers = workers.shown
        moreWorkers = workers.more
        self.models = models.shown
        moreModels = models.more
    }
}
