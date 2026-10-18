import Foundation

/// One row of the "@" menu (ADR-126).
public struct MentionItem: Sendable, Equatable, Identifiable {
    public enum Kind: Int, Sendable { case helper = 0, note, file, projectFile }

    public var kind: Kind
    public var name: String
    /// The helper's role, the page's kind ("Note", "Conversation note", …) or "From your Mac".
    public var detail: String
    /// The SF Symbol of the row.
    public var symbol: String
    public var helperId: String?
    public var noteId: Int?
    public var relativePath: String?

    public var id: String { "\(kind.rawValue)-\(relativePath ?? helperId ?? noteId.map(String.init) ?? name)" }

    public init(kind: Kind, name: String, detail: String, symbol: String = "", helperId: String? = nil, noteId: Int? = nil, relativePath: String? = nil) {
        self.kind = kind
        self.name = name
        self.detail = detail
        self.symbol = symbol
        self.helperId = helperId
        self.noteId = noteId
        self.relativePath = relativePath
    }
}

/// "@" in the chat box: a helper to hand the message to, a Second brain note to send with it, or a file (ADR-126).
///
/// SwiftUI's text field does not tell where the caret is, so the menu works on the "@word" at the end of the box,
/// which is where the words are being typed.
public enum MentionMenu {
    /// The most rows the menu shows.
    public static let limit = 8
    static let fileName = "A file…"

    /// The word after an "@" at the end of `draft` (empty right after the "@"); nil when the end is not a mention. The
    /// "@" starts the box or follows a space or new line, so "k@example" is not a mention; a space ends one.
    public static func query(in draft: String) -> String? {
        guard let at = draft.lastIndex(of: "@") else { return nil }
        if at > draft.startIndex, !draft[draft.index(before: at)].isWhitespace { return nil }
        let word = draft[draft.index(after: at)...]
        guard word.count <= 120, word.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == "." || $0 == "/" }) else { return nil }
        return String(word)
    }

    /// Ready helpers (not the improver, which nobody talks to) whose name starts with the query; Second brain pages with
    /// a word starting with it, those starting with it first, then newest; "A file…" when the query fits it. Any page
    /// can go except remembered facts, which stay out of messages (ADR-058), and ghosts, which have no words.
    public static func items(query: String, helpers: [Helper], notes: [BrainNode]) -> [MentionItem] {
        let q = fold(query)
        let people = helpers
            .filter { $0.available && $0.role != "improver" && fold($0.name).hasPrefix(q) }
            .map { MentionItem(kind: .helper, name: $0.name, detail: $0.roleTitle, symbol: "person.crop.circle", helperId: $0.id) }
        let titled = notes
            .filter { $0.kind != .memory && !$0.ghost }
            .compactMap { note -> (rank: Int, note: BrainNode)? in
                let title = fold(note.title)
                if title.hasPrefix(q) { return (0, note) }
                let words = title.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
                return words.contains(where: { $0.hasPrefix(q) }) ? (1, note) : nil
            }
            .sorted { a, b in
                a.rank != b.rank ? a.rank < b.rank : (a.note.updatedAt ?? .distantPast) > (b.note.updatedAt ?? .distantPast)
            }
            .map { MentionItem(kind: .note, name: $0.note.title, detail: one($0.note.kind), symbol: $0.note.kind.symbol, noteId: $0.note.id) }
        let file = q.isEmpty || fold("file").hasPrefix(q) ? [MentionItem(kind: .file, name: fileName, detail: "From your Mac", symbol: "paperclip")] : []
        // The file row is kept even when helpers and notes fill the menu.
        return Array((people + titled).prefix(limit - file.count)) + file
    }

    /// The box after choosing `item`: a helper's name replaces the "@word" (the runtime hands the message to it); a
    /// note or a file is attached instead, so the "@word" goes.
    public static func completing(_ item: MentionItem, in draft: String) -> String {
        guard let query = query(in: draft) else { return draft }
        let before = String(draft.dropLast(query.count + 1))
        return item.kind == .helper ? before + "@" + item.name + " " : before
    }

    /// One page of the kind, as the row's label.
    private static func one(_ kind: BrainKind) -> String {
        switch kind {
        case .note: "Note"
        case .memory: "Fact"
        case .episode: "Conversation note"
        case .chat: "Kept chat"
        case .project: "Project"
        case .entity: "Name"
        }
    }

    private static func fold(_ s: String) -> String { s.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil) }
}
