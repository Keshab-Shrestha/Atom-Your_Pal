import Foundation

// ADR-113: what the chat's composer holds besides the words: files waiting to be sent, and a skill picked by name. Pure:
// no views. The runtime checks every file again (type, size, secrets); this only keeps the list tidy.

/// A file chosen for the next message.
public struct DraftFile: Sendable, Equatable, Identifiable, Codable {
    public var path: String
    public var id: String { path }
    public var name: String { (path as NSString).lastPathComponent }

    public init(path: String) { self.path = path }
}

/// A Second brain note to send with a message, as "<title>.md" (ADR-126).
public struct DraftNote: Sendable, Equatable, Identifiable, Codable {
    public var id: Int
    public var title: String

    public init(id: Int, title: String) {
        self.id = id
        self.title = title
    }
}

public struct ComposerDraft: Sendable, Equatable, Codable {
    /// The most files one message takes (the runtime's limit).
    public static let maxFiles = 5
    /// The most characters one message takes (the runtime's limit).
    public static let maxCharacters = 4000
    public private(set) var files: [DraftFile] = []
    /// Notes go as files, so they count toward `maxFiles` (ADR-126).
    public private(set) var notes: [DraftNote] = []
    /// Why the last file was not added ("5 files at most").
    public private(set) var notice: String?

    public init() {}

    private enum CodingKeys: String, CodingKey { case files, notes }

    /// Saved paths and note ids are input references, never permissions. Reject malformed snapshots without truncation.
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let savedFiles = try values.decode([DraftFile].self, forKey: .files)
        let savedNotes = try values.decode([DraftNote].self, forKey: .notes)
        files = savedFiles
        notes = savedNotes
        guard validSavedReferences else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid saved attachments"))
        }
    }

    var validSavedReferences: Bool {
        files.count + notes.count <= Self.maxFiles
            && Set(files.map(\.path)).count == files.count
            && Set(notes.map(\.id)).count == notes.count
            && files.allSatisfy { $0.path.hasPrefix("/") && $0.path.utf8.count <= 4096 && !$0.path.contains("\0") }
            && notes.allSatisfy { $0.id > 0 && $0.title.utf8.count <= 4096 }
    }

    /// Adds files by full path. Duplicates and non-file URLs are skipped; past the limit the rest are dropped with a notice.
    public mutating func add(_ paths: [String]) {
        notice = nil
        for path in paths where path.hasPrefix("/") && !files.contains(where: { $0.path == path }) {
            if files.count + notes.count >= Self.maxFiles {
                notice = "A message takes \(Self.maxFiles) files at most."
                return
            }
            files.append(DraftFile(path: path))
        }
    }

    public mutating func remove(_ path: String) {
        files.removeAll { $0.path == path }
        notice = nil
    }

    /// Adds a Second brain note once; past the limit it is dropped with a notice.
    public mutating func add(note: DraftNote) {
        notice = nil
        guard !notes.contains(where: { $0.id == note.id }) else { return }
        guard files.count + notes.count < Self.maxFiles else {
            notice = "A message takes \(Self.maxFiles) files at most."
            return
        }
        notes.append(note)
    }

    public mutating func remove(note id: Int) {
        notes.removeAll { $0.id == id }
        notice = nil
    }

    /// No files and no notes.
    public var isEmpty: Bool { files.isEmpty && notes.isEmpty }

    public mutating func clear() {
        files = []
        notes = []
        notice = nil
    }

    /// Why these words cannot be sent as they are, or nil. The composer keeps the draft and says so, instead of clearing it: a long paste
    /// used to vanish without a word (code review, 2026-10-16).
    public static func refusal(forText text: String) -> String? {
        let count = text.trimmingCharacters(in: .whitespacesAndNewlines).count
        return count > maxCharacters ? "That message is \(count) characters; one message takes \(maxCharacters). Shorten it, or attach it as a file." : nil
    }

    /// Shows `message` in the composer's notice line (nothing else changes).
    public mutating func refuse(_ message: String) { notice = message }

    /// The command for these words and files; nil when there is nothing to send.
    public func command(text: String) -> IslandCommand? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean.count <= Self.maxCharacters, !clean.isEmpty || !isEmpty else { return nil }
        return isEmpty ? .textSend(clean) : .textSendFiles(text: clean, files: files.map(\.path), notes: notes.map(\.id))
    }

    /// The words with a skill's name in front: "/summarise " (an existing one is replaced, not doubled).
    public static func applying(skill name: String, to text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("/") {
            let rest = trimmed.drop(while: { $0 != " " }).trimmingCharacters(in: .whitespaces)
            return "/\(name) \(rest)"
        }
        return "/\(name) \(trimmed)"
    }
}
