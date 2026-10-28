import Foundation
import Darwin

/// ADR-141: local unsent input only. Live queue state and delivery acknowledgements are not restored.
public struct ChatInput: Codable, Sendable, Equatable {
    public struct Entry: Codable, Sendable, Equatable {
        public var text = ""
        public var files = ComposerDraft()
        /// Held for review after a restart; never fed back into the live queue automatically.
        public var waiting: [QueuedMessage] = []
        public var questionAnswers: [PendingQuestionAnswer] = []
        public var isEmpty: Bool { text.isEmpty && files.isEmpty && waiting.isEmpty && questionAnswers.isEmpty }
        public init() {}
        private enum CodingKeys: String, CodingKey { case text, files, waiting, questionAnswers }
        public init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            text = try values.decode(String.self, forKey: .text)
            files = try values.decode(ComposerDraft.self, forKey: .files)
            questionAnswers = try values.decodeIfPresent([PendingQuestionAnswer].self, forKey: .questionAnswers) ?? []
            if let list = try? values.decode([QueuedMessage].self, forKey: .waiting) {
                waiting = list
            } else {
                waiting = try values.decodeIfPresent(QueuedMessage.self, forKey: .waiting).map { [$0] } ?? []
            }
        }
    }

    public private(set) var entries: [String: Entry] = [:]
    private var version = 3
    public init() {}
    private enum CodingKeys: String, CodingKey { case version, entries }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let savedVersion = try values.decode(Int.self, forKey: .version)
        guard [1, 2, 3].contains(savedVersion) else { throw ChatInputStore.Failure.invalid }
        entries = try values.decode([String: Entry].self, forKey: .entries)
        try validate()
    }
    public func entry(for chat: String) -> Entry { entries[chat] ?? Entry() }
    public mutating func set(_ entry: Entry, for chat: String) { entries[chat] = entry.isEmpty ? nil : entry }
    public mutating func remove(_ chat: String) { entries[chat] = nil }

    /// Explicit recovery into an empty new chat, or assignment of the first chat id.
    public mutating func move(from source: String, to target: String) {
        guard source != target, entries[target] == nil, var entry = entries.removeValue(forKey: source) else { return }
        for index in entry.waiting.indices { entry.waiting[index].chat = target }
        if !entry.questionAnswers.isEmpty {
            var retained = Entry(); retained.questionAnswers = entry.questionAnswers
            entries[source] = retained; entry.questionAnswers = []
        }
        entries[target] = entry
    }

    public func validate() throws {
        guard version == 3, entries.count <= 100 else { throw ChatInputStore.Failure.invalid }
        var ids = Set<String>()
        for (chat, entry) in entries {
            guard chat.utf8.count <= 512, !chat.contains("\0"),
                  entry.files.validSavedReferences, entry.waiting.count <= MessageQueue.limit, entry.questionAnswers.count <= 20 else { throw ChatInputStore.Failure.invalid }
            for answer in entry.questionAnswers {
                guard answer.chat == chat, UUID(uuidString: answer.id) != nil, UUID(uuidString: answer.turn) != nil,
                      answer.question.utf16.count <= 600, !answer.answer.isEmpty,
                      ids.insert(answer.id).inserted else { throw ChatInputStore.Failure.invalid }
            }
            for message in entry.waiting {
                guard message.chat == chat, message.files.validSavedReferences,
                      UUID(uuidString: message.id) != nil, ids.insert(message.id).inserted else { throw ChatInputStore.Failure.invalid }
            }
        }
    }
}

/// Owner-only, atomic local snapshot. A failed load is left untouched; callers must not save over it.
/// Attachment bytes remain in their original location and are checked again by the host at send time.
public struct ChatInputStore: Sendable {
    public enum Failure: Error { case invalid, io }
    public let url: URL
    private static let maxBytes = 8 * 1024 * 1024
    public init(url: URL) { self.url = url }

    public static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/ATOM/ChatInput/input.json")
    }

    public func load() throws -> ChatInput {
        let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard fd >= 0 else {
            if errno == ENOENT { return ChatInput() }
            throw Failure.io
        }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? handle.close() }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              info.st_size <= Self.maxBytes, info.st_uid == getuid(),
              fchmod(fd, 0o600) == 0 else { throw Failure.invalid }
        let data = try handle.read(upToCount: Self.maxBytes + 1) ?? Data()
        guard data.count <= Self.maxBytes else { throw Failure.invalid }
        let input = try JSONDecoder().decode(ChatInput.self, from: data)
        try input.validate()
        return input
    }

    public func save(_ input: ChatInput) throws {
        try input.validate()
        let data = try JSONEncoder().encode(input)
        guard data.count <= Self.maxBytes else { throw Failure.invalid }
        let fm = FileManager.default
        let directory = url.deletingLastPathComponent()
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let attributes = try fm.attributesOfItem(atPath: directory.path)
        guard attributes[.type] as? FileAttributeType == .typeDirectory,
              (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid() else { throw Failure.io }
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let temporary = directory.appendingPathComponent(".input-\(UUID().uuidString)")
        let fd = Darwin.open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw Failure.io }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? handle.close(); try? fm.removeItem(at: temporary) }
        try handle.write(contentsOf: data)
        try handle.synchronize()
        guard Darwin.rename(temporary.path, url.path) == 0 else { throw Failure.io }
    }
}
