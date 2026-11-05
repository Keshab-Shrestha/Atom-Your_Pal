import Foundation

// The Stats page (2026-11-05; the runtime's stats.ts): ARK's tool and turn numbers for the last week, counted from its own log. Names, counts
// and times only: never an input, an output or a word of any chat.

public struct ToolStatRow: Sendable, Equatable, Identifiable {
    public var name: String
    public var calls: Int
    public var failed: Int
    public var avgMs: Int
    /// Calls the model made a third time or more with the same input in one turn (ADR-243).
    public var repeats: Int
    public var id: String { name }

    public init(name: String, calls: Int, failed: Int, avgMs: Int, repeats: Int) {
        self.name = name; self.calls = calls; self.failed = failed; self.avgMs = avgMs; self.repeats = repeats
    }

    /// "0 failed" or "3 failed (12%)".
    public var failureText: String {
        guard failed > 0 else { return "0 failed" }
        return "\(failed) failed (\(Int((Double(failed) / Double(max(1, calls)) * 100).rounded()))%)"
    }
}

public struct ToolStats: Sendable, Equatable {
    public var days: Int
    public var turns: Int
    public var avgTurnMs: Int
    public var slowTurns: Int
    public var totalCalls: Int
    public var totalFailed: Int
    public var tools: [ToolStatRow]

    public init(days: Int = 7, turns: Int = 0, avgTurnMs: Int = 0, slowTurns: Int = 0, totalCalls: Int = 0, totalFailed: Int = 0, tools: [ToolStatRow] = []) {
        self.days = days; self.turns = turns; self.avgTurnMs = avgTurnMs; self.slowTurns = slowTurns
        self.totalCalls = totalCalls; self.totalFailed = totalFailed; self.tools = tools
    }

    public var isEmpty: Bool { totalCalls == 0 && turns == 0 }

    /// A time in words: "120 ms", "1.5 s", "2 min".
    public static func duration(_ ms: Int) -> String {
        if ms < 1000 { return "\(ms) ms" }
        if ms < 60_000 { return String(format: "%.1f s", Double(ms) / 1000) }
        return "\(Int((Double(ms) / 60_000).rounded())) min"
    }

    /// A malformed row is left out; a missing number is zero.
    public static func from(_ values: [String: Any]) -> ToolStats {
        func int(_ any: Any?) -> Int { (any as? Int) ?? Int((any as? Double) ?? 0) }
        let rows = (values["tools"] as? [Any] ?? []).compactMap { entry -> ToolStatRow? in
            guard let r = entry as? [String: Any], let name = r["name"] as? String, !name.isEmpty else { return nil }
            return ToolStatRow(name: name, calls: int(r["calls"]), failed: int(r["failed"]), avgMs: int(r["avgMs"]), repeats: int(r["repeats"]))
        }
        return ToolStats(days: max(1, int(values["days"])), turns: int(values["turns"]), avgTurnMs: int(values["avgTurnMs"]), slowTurns: int(values["slowTurns"]),
                         totalCalls: int(values["totalCalls"]), totalFailed: int(values["totalFailed"]), tools: rows)
    }
}
