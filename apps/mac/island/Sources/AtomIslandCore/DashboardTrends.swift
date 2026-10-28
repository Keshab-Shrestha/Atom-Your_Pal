import Foundation

/// The tabs of the Dashboard's Trends panel (from the HTML preview): one chart at a time instead of three stacked ones.
public enum DashboardTrendKind: Int, CaseIterable, Sendable {
    case tokens, cacheReuse, runs

    public var title: String {
        switch self {
        case .tokens: "Tokens"
        case .cacheReuse: "Cache reuse"
        case .runs: "Runs"
        }
    }

    public var detail: String {
        switch self {
        case .tokens: "Input + output · 7 days"
        case .cacheReuse: "Cached input · 7 days"
        case .runs: "Recorded calls · 7 days"
        }
    }
}

/// One row of the Dashboard's Recent turns bars: the model, the tokens, how much of the prompt came from the cache, and a
/// bar split into input and output. Bar lengths are shares of the largest run shown, so the rows compare with each other.
public struct RecentTurnBar: Equatable, Sendable {
    public let model: String
    public let kindTitle: String
    public let tokensText: String
    public let cachedText: String
    public let inputShare: Double
    public let outputShare: Double

    public static func bars(_ runs: [RecentTokens], limit: Int = 6) -> [RecentTurnBar] {
        let shown = Array(runs.prefix(max(0, limit)))
        let largest = max(1, shown.map(\.io).max() ?? 1)
        return shown.map { run in
            let totals = TokenTotals(input: run.input, output: run.output, cacheRead: run.cacheRead, cacheWrite: run.cacheWrite)
            return RecentTurnBar(
                model: run.model, kindTitle: run.kindTitle, tokensText: TokenTotals.short(run.io),
                cachedText: totals.cacheHitRate.map { _ in totals.cacheHitText + " cached" } ?? "No prompt tokens",
                inputShare: Double(run.input) / Double(largest), outputShare: Double(run.output) / Double(largest))
        }
    }
}
