import Foundation

/// Plain words for the tool calls a chat turn makes (2026-11-01, after T3 Code's tool rows and summarizeToolGroup, MIT):
/// "Reading a file" while it runs, "Read a file" once done, and one line for a finished turn: "Read 3 files, ran 2 commands".
public enum ChatWorkText {
    private struct Kind: Equatable {
        let present: String
        let pastOne: String
        let pastMany: String // "%d" is the count
    }

    private static func kind(_ tool: String) -> Kind {
        switch tool {
        case "Read", "NotebookRead": return Kind(present: "Reading a file", pastOne: "Read a file", pastMany: "Read %d files")
        case "Write", "Edit", "MultiEdit", "NotebookEdit": return Kind(present: "Editing a file", pastOne: "Edited a file", pastMany: "Edited %d files")
        case "Bash", "BashOutput": return Kind(present: "Running a command", pastOne: "Ran a command", pastMany: "Ran %d commands")
        case "Grep", "Glob", "LS": return Kind(present: "Searching files", pastOne: "Searched files", pastMany: "Searched files %d times")
        case "WebSearch": return Kind(present: "Searching the web", pastOne: "Searched the web", pastMany: "Searched the web %d times")
        case "WebFetch": return Kind(present: "Reading a web page", pastOne: "Read a web page", pastMany: "Read %d web pages")
        case "Agent", "Task": return Kind(present: "Starting an agent", pastOne: "Started an agent", pastMany: "Started %d agents")
        case "TodoWrite": return Kind(present: "Updating the to-do list", pastOne: "Updated the to-do list", pastMany: "Updated the to-do list %d times")
        default:
            // "mcp__ark__plan_work" reads as "plan work"; any other name as it is.
            let name = tool.hasPrefix("mcp__") ? String(tool.split(separator: "_", omittingEmptySubsequences: true).dropFirst(2).joined(separator: " ")) : tool
            let shown = name.isEmpty ? tool : name
            return Kind(present: "Using \(shown)", pastOne: "Used \(shown)", pastMany: "Used \(shown) %d times")
        }
    }

    /// The glyph in a call's tile (2026-11-05, after affectUI's Tool Call Card, MIT): one per kind of work.
    public static func symbol(tool: String) -> String {
        switch tool {
        case "Read", "NotebookRead": "doc.text"
        case "Write", "Edit", "MultiEdit", "NotebookEdit": "pencil"
        case "Bash", "BashOutput": "terminal"
        case "Grep", "Glob", "LS": "magnifyingglass"
        case "WebSearch": "globe"
        case "WebFetch": "link"
        case "Agent", "Task": "person.2"
        case "TodoWrite": "checklist"
        default: "wrench.and.screwdriver"
        }
    }

    /// The thinking pill's words (after affectUI's Thinking Loader, MIT), from what ARK really does now: the newest running
    /// call ("Reading a file"), else "Thinking". Never a made-up phase on a timer.
    public static func phase(_ work: ChatWorkSnapshot?) -> String {
        guard let running = work?.calls.last(where: { $0.state == "started" }) else { return "Thinking" }
        return label(tool: running.tool, running: true)
    }

    /// A short time: "4s", "1m 15s", "2h 05m", "9d 15h" (after affectUI's `took`).
    public static func duration(ms: Double) -> String {
        let s = max(0, Int(ms / 1000))
        if s < 60 { return "\(s)s" }
        let m = s / 60
        if m < 60 { return "\(m)m \(s % 60)s" }
        let h = m / 60
        return h < 24 ? "\(h)h " + String(format: "%02dm", m % 60) : "\(h / 24)d \(h % 24)h"
    }

    /// One call's row text: what it does while running, what it did once it ended.
    public static func label(tool: String, running: Bool) -> String {
        let k = kind(tool)
        return running ? k.present : k.pastOne
    }

    /// A finished turn's tools in one line: the two most frequent kinds, then how many others. Empty with no calls.
    public static func summary(_ calls: [ChatWorkSnapshot.Call]) -> String {
        var order: [Kind] = []
        var counts: [String: Int] = [:]
        for call in calls {
            let k = kind(call.tool)
            if counts[k.pastOne] == nil { order.append(k) }
            counts[k.pastOne, default: 0] += 1
        }
        let ranked = order.enumerated().sorted { a, b in
            let (ca, cb) = (counts[a.element.pastOne]!, counts[b.element.pastOne]!)
            return ca != cb ? ca > cb : a.offset < b.offset
        }.map(\.element)
        var parts = ranked.prefix(2).map { k -> String in
            let n = counts[k.pastOne]!
            return n == 1 ? k.pastOne : String(format: k.pastMany, n)
        }
        let others = ranked.dropFirst(2).reduce(0) { $0 + counts[$1.pastOne]! }
        if others > 0 { parts.append("\(others) more") }
        return parts.enumerated().map { i, part in i == 0 ? part : part.prefix(1).lowercased() + part.dropFirst() }.joined(separator: ", ")
    }
}
