import Foundation

// ADR-125: what the chat box does besides holding words and files (ComposerDraft): several lines, ↑ for the last
// message, a draft for each chat, and images pasted with ⌘V. Pure: no views, so every rule here is tested.

/// The box grows with its words up to this many lines, then scrolls.
public enum ComposerLines {
    public static let range: ClosedRange<Int> = 1...8
}

/// ↑ in an empty box brings back the last message sent in this chat, ↑ again the one before; ↓ goes back toward the
/// newest and then to an empty box. Words the user typed or changed are never replaced: there ↑ and ↓ move the cursor.
public struct MessageRecall: Sendable, Equatable {
    /// The most messages ↑ reaches.
    public static let limit = 50
    /// Oldest first, no blanks, no message twice in a row.
    public let entries: [String]
    /// The entry in the box now; nil when not recalling.
    public private(set) var position: Int?

    public init(sent: [String]) {
        var kept: [String] = []
        for message in sent {
            let clean = message.trimmingCharacters(in: .whitespacesAndNewlines)
            if !clean.isEmpty && kept.last != clean { kept.append(clean) }
        }
        entries = Array(kept.suffix(Self.limit))
    }

    /// The box shows what ↑ or ↓ put there, unchanged.
    private func isShowingRecall(_ current: String) -> Bool {
        guard let position else { return false }
        return entries[position] == current
    }

    /// What ↑ puts in the box, or nil when ↑ belongs to the cursor.
    public mutating func older(current: String) -> String? {
        if current.isEmpty {
            guard !entries.isEmpty else { return nil }
            position = entries.count - 1
            return entries[entries.count - 1]
        }
        guard isShowingRecall(current), let position, position > 0 else { return nil }
        self.position = position - 1
        return entries[position - 1]
    }

    /// What ↓ puts in the box ("" past the newest), or nil when ↓ belongs to the cursor.
    public mutating func newer(current: String) -> String? {
        guard isShowingRecall(current), let position else { return nil }
        if position + 1 < entries.count {
            self.position = position + 1
            return entries[position + 1]
        }
        self.position = nil
        return ""
    }
}

/// Unsent words and files, kept for each chat while ATOM runs, so changing chats never loses half a message. Not
/// saved to disk: a draft is gone after ATOM quits.
public struct ChatDrafts: Sendable, Equatable {
    /// The most chats that keep a draft; the oldest is dropped first.
    public static let limit = 20

    public struct Draft: Sendable, Equatable {
        public var text: String
        public var files: ComposerDraft
    }

    private var drafts: [String: Draft] = [:]
    /// Chat ids, oldest draft first.
    private var order: [String] = []

    public init() {}

    public var isEmpty: Bool { drafts.isEmpty }
    public var count: Int { drafts.count }
    public func text(for chat: String) -> String { drafts[chat]?.text ?? "" }

    /// Keeps the words and files of the chat being left and hands back those of the chat being opened (empty when it
    /// has none). Its draft is taken out: from now on it is in the box. A new chat has no id ("") until its first
    /// answer saves it; that change of id is the same chat, so the box keeps its words.
    public mutating func switching(from old: String?, to new: String?, text: String, files: ComposerDraft) -> Draft {
        guard old != new else { return Draft(text: text, files: files) }
        if old == "", let new, !new.isEmpty, drafts[new] == nil { return Draft(text: text, files: files) }
        if let old {
            order.removeAll { $0 == old }
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && files.files.isEmpty {
                drafts[old] = nil
            } else {
                drafts[old] = Draft(text: text, files: files)
                order.append(old)
                while order.count > Self.limit { drafts[order.removeFirst()] = nil }
            }
        }
        guard let new, let draft = drafts.removeValue(forKey: new) else { return Draft(text: "", files: ComposerDraft()) }
        order.removeAll { $0 == new }
        return draft
    }
}

/// An image pasted with ⌘V becomes a PNG file in the system's temp folder, then attaches like any file. The runtime
/// refuses parts of ~/Library and its own folder, and copies an attached file into the chat when it is sent.
public enum PastedImage {
    public static var directory: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("atom-pasted", isDirectory: true)
    }

    /// The runtime's limit for one file (`MAX_ATTACH_BYTES` in attachments.ts).
    public static let maxBytes = 10 * 1024 * 1024
    /// Temp copies older than this are removed when the next image is pasted.
    public static let keepFor: TimeInterval = 24 * 60 * 60

    public enum Encoding: Sendable, Equatable {
        case png, jpeg
        public var ext: String { self == .png ? "png" : "jpg" }
    }

    /// PNG keeps a screenshot sharp; one over the runtime's limit (a full Retina screen) goes as JPEG instead.
    public static func encoding(pngBytes: Int) -> Encoding { pngBytes <= maxBytes ? .png : .jpeg }

    /// "Pasted image 2026-10-16 at 23.05.09.png": dots, not colons, as macOS names screenshots.
    public static func fileName(at date: Date, ext: String = "png", calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        return String(format: "Pasted image %04d-%02d-%02d at %02d.%02d.%02d.%@",
                      c.year ?? 0, c.month ?? 0, c.day ?? 0, c.hour ?? 0, c.minute ?? 0, c.second ?? 0, ext)
    }

    /// Removes pasted images older than `keepFor`. The runtime copied each into its chat when it was sent.
    public static func removeOld(in dir: URL = directory, now: Date = Date()) {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return }
        for name in names {
            let path = dir.appendingPathComponent(name).path
            guard let modified = (try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date else { continue }
            if now.timeIntervalSince(modified) > keepFor { try? fm.removeItem(atPath: path) }
        }
    }
}

/// What ⌘V in the chat box does with what is on the clipboard.
public enum PasteChoice: Sendable, Equatable {
    /// Attach these files (copied in Finder; the clipboard also holds their names as text).
    case files([String])
    /// Attach the clipboard's image as a PNG (a screenshot copied with ⌃⇧⌘4).
    case image
    /// The field's own paste.
    case text

    public static func choose(fileURLs: [String], hasText: Bool, hasImage: Bool) -> PasteChoice {
        if !fileURLs.isEmpty { return .files(fileURLs) }
        if hasText { return .text }
        return hasImage ? .image : .text
    }
}
