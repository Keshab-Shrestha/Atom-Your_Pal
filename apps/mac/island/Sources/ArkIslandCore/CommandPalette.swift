import Foundation

/// One thing the ⌘K palette can do or open (2026-11-02, after Keshab's "Agent CRM workspace" reference). Pure: the app maps
/// `id` to its action.
public struct PaletteEntry: Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let detail: String
    public let symbol: String
    /// The section it is listed under: Actions, Go to, Chats, Agents, Projects, Settings, Themes.
    public let group: String
    /// More words it answers to, such as "board" for "Studio".
    public let keywords: String

    public init(id: String, title: String, detail: String = "", symbol: String, group: String, keywords: String = "") {
        self.id = id; self.title = title; self.detail = detail; self.symbol = symbol; self.group = group; self.keywords = keywords
    }
}

public enum PaletteSearch {
    /// The entries that hold every typed word (in the title, detail, group or keywords, any case and accent), best first:
    /// a title that starts with the query, then a title word that starts with the first word, then the rest. Ties keep the
    /// given order. An empty query gives the given order. At most `limit`.
    public static func rank(_ entries: [PaletteEntry], _ query: String, limit: Int = 40) -> [PaletteEntry] {
        let fold = { (s: String) in s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil) }
        let q = fold(query.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !q.isEmpty else { return Array(entries.prefix(limit)) }
        let words = q.split(whereSeparator: \.isWhitespace).map(String.init)
        let scored = entries.enumerated().compactMap { index, entry -> (Int, Int, PaletteEntry)? in
            let title = fold(entry.title)
            let haystack = [title, fold(entry.detail), fold(entry.group), fold(entry.keywords)].joined(separator: " ")
            guard words.allSatisfy(haystack.contains) else { return nil }
            let titleWords = title.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            let score = title.hasPrefix(q) ? 0 : titleWords.contains(where: { $0.hasPrefix(words[0]) }) ? 1 : 2
            return (score, index, entry)
        }
        return scored.sorted { ($0.0, $0.1) < ($1.0, $1.1) }.prefix(limit).map(\.2)
    }
}
