// Token usage and its trend (split out of Helpers.swift, 2026-10-16).
import Foundation

/// ADR-091: tokens one or more runs used, and their API-equivalent dollars (the plan does not charge them).
public struct TokenTotals: Sendable, Equatable {
    public var input: Int, output: Int, cacheRead: Int, cacheWrite: Int
    public var dollars: Double
    public var runs: Int

    public init(input: Int = 0, output: Int = 0, cacheRead: Int = 0, cacheWrite: Int = 0, dollars: Double = 0, runs: Int = 0) {
        self.input = input
        self.output = output
        self.cacheRead = cacheRead
        self.cacheWrite = cacheWrite
        self.dollars = dollars
        self.runs = runs
    }

    public var total: Int { input + output + cacheRead + cacheWrite }
    /// Token cost, job 4: what you typed and what ATOM answered. The Dashboard's main number; the cache counts are shown apart.
    public var io: Int { input + output }
    /// Everything but what was read back from the cache (which counts far less toward the plan's limits).
    public var fresh: Int { input + output + cacheWrite }
    /// ADR-098 item 9: the share of the prompt read back from the cache (cache reads ÷ all prompt tokens); nil without any.
    public var cacheHitRate: Double? {
        let prompt = input + cacheRead + cacheWrite
        return prompt > 0 ? Double(cacheRead) / Double(prompt) : nil
    }
    /// "73%", or "–" without any prompt tokens.
    public var cacheHitText: String { cacheHitRate.map { String(format: "%.0f%%", $0 * 100) } ?? "–" }

    /// A kind's share of the total for the Token mix: "1.6%" under 10%, "17%" above, "<0.1%" for a tiny part, "0%" for none.
    public static func sharePercent(_ part: Int, of total: Int) -> String {
        guard part > 0, total > 0 else { return "0%" }
        let percent = Double(part) / Double(total) * 100
        if percent < 0.05 { return "<0.1%" }
        return percent < 9.95 ? String(format: "%.1f%%", percent) : String(format: "%.0f%%", percent)
    }

    /// 850, 12.4K, 3.1M.
    public static func short(_ n: Int) -> String {
        switch n {
        case ..<1000: "\(n)"
        case ..<1_000_000: String(format: n < 10000 ? "%.1fK" : "%.0fK", Double(n) / 1000)
        default: String(format: "%.1fM", Double(n) / 1_000_000)
        }
    }
}

public struct DayTokens: Sendable, Equatable {
    /// YYYY-MM-DD, local.
    public var day: String
    public var totals: TokenTotals
}

public struct WorkerTokens: Sendable, Equatable {
    /// Nil: ATOM's own chat.
    public var helper: String?
    public var name: String
    public var totals: TokenTotals
}

public struct ModelTokens: Sendable, Equatable {
    public var model: String
    public var totals: TokenTotals
}

/// Token cost, job 4: one recent call, for the Dashboard's list of turns.
public struct RecentTokens: Sendable, Equatable {
    public enum Kind: String, Sendable { case turn, note, job, other }
    public var at: Date?
    public var kind: Kind
    public var model: String
    public var input: Int, output: Int, cacheRead: Int, cacheWrite: Int
    /// Milliseconds since the last call of the same chat and model; nil for the first.
    public var gapMs: Int?

    public init(at: Date? = nil, kind: Kind, model: String, input: Int, output: Int, cacheRead: Int, cacheWrite: Int, gapMs: Int? = nil) {
        self.at = at
        self.kind = kind
        self.model = model
        self.input = input
        self.output = output
        self.cacheRead = cacheRead
        self.cacheWrite = cacheWrite
        self.gapMs = gapMs
    }

    public var io: Int { input + output }

    /// The row's first column: "This turn", "Note", "Job" or "Other" (calls Claude Code made itself).
    public var kindTitle: String {
        switch kind { case .turn: "This turn"; case .note: "Note"; case .job: "Job"; case .other: "Other" }
    }

    /// "This turn: 18 tokens · cache written: 6.1k · cache read: 0".
    public var splitLine: String {
        let who = switch kind { case .turn: "This turn"; case .note: "Note"; case .job: "Job"; case .other: "Other" }
        return "\(who): \(TokenTotals.short(io)) tokens · cache written: \(TokenTotals.short(cacheWrite)) · cache read: \(TokenTotals.short(cacheRead))"
    }
}

/// ADR-091: the Dashboard's tokens: today, the week, each of the last 7 days, each worker and each model.
public struct TokenUsageSummary: Sendable, Equatable {
    public var today: TokenTotals
    public var week: TokenTotals
    public var days: [DayTokens]
    public var byWorker: [WorkerTokens]
    public var byModel: [ModelTokens]
    /// ADR-098 item 9: ATOM's last chat answers read nothing from the cache.
    public var chatCacheCold: Bool
    /// Token cost, job 4: the newest calls, newest first; empty from an older runtime.
    public var recent: [RecentTokens]

    public init(today: TokenTotals, week: TokenTotals, days: [DayTokens] = [], byWorker: [WorkerTokens] = [], byModel: [ModelTokens] = [], chatCacheCold: Bool = false, recent: [RecentTokens] = []) {
        self.recent = recent
        self.today = today
        self.week = week
        self.days = days
        self.byWorker = byWorker
        self.byModel = byModel
        self.chatCacheCold = chatCacheCold
    }
}

/// How today's input + output compares with a usual day (2026-10-15): the Dashboard's lead number says more with it.
public enum UsageTrend: Sendable, Equatable {
    case above(percent: Int)
    case below(percent: Int)
    case usual

    /// "12% above a usual day so far", "about a usual day so far".
    public var text: String {
        switch self {
        case .above(let percent): "\(percent)% above a usual day so far"
        case .below(let percent): "\(percent)% below a usual day so far"
        case .usual: "about a usual day so far"
        }
    }
}

extension TokenUsageSummary {
    /// Today against the mean of the other days that had any use. Nil when no other day had use. Within 5% is "usual".
    /// Today is the last day in `days`; it is a partial day, which the words say ("so far").
    public var todayTrend: UsageTrend? {
        let others = days.dropLast().map(\.totals.io).filter { $0 > 0 }
        guard !others.isEmpty else { return nil }
        let mean = Double(others.reduce(0, +)) / Double(others.count)
        let change = (Double(today.io) - mean) / mean * 100
        let percent = Int(abs(change).rounded())
        if percent < 5 { return .usual }
        return change > 0 ? .above(percent: percent) : .below(percent: percent)
    }
}
