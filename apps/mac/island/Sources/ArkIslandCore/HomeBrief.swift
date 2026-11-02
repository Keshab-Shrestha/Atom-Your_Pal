import Foundation

/// Home's greeting and today's one fact (2026-11-02, the "Editorial greeting" of Keshab's reference: "Good evening, Sam.
/// 18 invoices are overdue."). Pure.
public enum HomeBrief {
    /// "Good morning" before 12, "Good afternoon" before 18, else "Good evening"; the first name when there is one.
    public static func greeting(hour: Int, name: String) -> String {
        let part = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
        let first = name.split(separator: " ").first.map(String.init) ?? ""
        return first.isEmpty ? "\(part)." : "\(part), \(first)."
    }

    /// The one thing worth knowing now: what waits for you first, then who works, then the day's use.
    public static func fact(needsYou: Int, working: Int, tokensToday: Int) -> String {
        let agents = { (n: Int) in n == 1 ? "1 agent is" : "\(n) agents are" }
        if needsYou > 0 {
            let waits = needsYou == 1 ? "1 thing needs you" : "\(needsYou) things need you"
            return working > 0 ? "\(waits), and \(agents(working)) at work." : "\(waits)."
        }
        if working > 0 { return "\(agents(working)) at work. Nothing needs you." }
        if tokensToday > 0 { return "All quiet: \(TokenTotals.short(tokensToday)) tokens so far today." }
        return "All quiet. Ask ARK anything."
    }
}
