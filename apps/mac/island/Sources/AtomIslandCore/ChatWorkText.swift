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
            // "mcp__atom__plan_work" reads as "plan work"; any other name as it is.
            let name = tool.hasPrefix("mcp__") ? String(tool.split(separator: "_", omittingEmptySubsequences: true).dropFirst(2).joined(separator: " ")) : tool
            let shown = name.isEmpty ? tool : name
            return Kind(present: "Using \(shown)", pastOne: "Used \(shown)", pastMany: "Used \(shown) %d times")
        }
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
