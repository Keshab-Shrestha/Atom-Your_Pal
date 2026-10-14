import Foundation

// ADR-113: what the chat's composer holds besides the words: files waiting to be sent, and a skill picked by name. Pure:
// no views. The runtime checks every file again (type, size, secrets); this only keeps the list tidy.

/// A file chosen for the next message.
public struct DraftFile: Sendable, Equatable, Identifiable {
    public var path: String
    public var id: String { path }
    public var name: String { (path as NSString).lastPathComponent }

    public init(path: String) { self.path = path }
}

public struct ComposerDraft: Sendable, Equatable {
    /// The most files one message takes (the runtime's limit).
    public static let maxFiles = 5
    public private(set) var files: [DraftFile] = []
    /// Why the last file was not added ("5 files at most").
    public private(set) var notice: String?

    public init() {}

    /// Adds files by full path. Duplicates and non-file URLs are skipped; past the limit the rest are dropped with a notice.
    public mutating func add(_ paths: [String]) {
        notice = nil
        for path in paths where path.hasPrefix("/") && !files.contains(where: { $0.path == path }) {
            if files.count >= Self.maxFiles {
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

    public mutating func clear() {
        files = []
        notice = nil
    }

    /// The command for these words and files; nil when there is nothing to send.
    public func command(text: String) -> IslandCommand? {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean.count <= 4000, !clean.isEmpty || !files.isEmpty else { return nil }
        return files.isEmpty ? .textSend(clean) : .textSendFiles(text: clean, files: files.map(\.path))
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
