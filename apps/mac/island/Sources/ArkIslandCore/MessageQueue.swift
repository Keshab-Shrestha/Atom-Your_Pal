import Foundation

/// One unsent message, with identity preserved while queued and across restart (ADR-142).
public struct QueuedMessage: Sendable, Equatable, Codable, Identifiable {
    public let id: String
    public var text: String
    public var files: ComposerDraft
    public var chat: String?

    public init(text: String, files: ComposerDraft, chat: String?, id: String = UUID().uuidString) {
        self.id = id
        self.text = text
        self.files = files
        self.chat = chat
    }

    private enum CodingKeys: String, CodingKey { case id, text, files, chat }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        // ADR-141's single waiting message had no id; migration gives it one without sending it.
        id = try values.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        text = try values.decode(String.self, forKey: .text)
        files = try values.decode(ComposerDraft.self, forKey: .files)
        chat = try values.decodeIfPresent(String.self, forKey: .chat)
    }
}

/// A bounded FIFO. Only a newly completed active turn can advance it; duplicate idle events cannot drain it.
/// Restored messages are held separately in ChatInput and never populate this live queue.
public struct MessageQueue: Sendable, Equatable {
    public static let limit = 20
    public enum Outcome: Sendable, Equatable {
        case none
        case send(QueuedMessage)
        case backToBox([QueuedMessage])
    }

    public private(set) var messages: [QueuedMessage] = []
    public var next: QueuedMessage? { messages.first }
    public var running: Bool { active || awaitingStart }
    public private(set) var awaitingStart = false
    private var active = false
    /// The turn's final reply has arrived; ARK may still be reading it aloud (2026-11-06).
    private var replied = false
    private var stop = false
    private var failure = false
    public init() {}

    public mutating func turn(_ state: LoopState, chat: String? = nil) -> Outcome {
        let ended = active
        switch state {
        case .transcribing, .thinking:
            replied = false
            active = true
        // Speech can start on the first sentence while the model still writes, so speaking holds input until the reply is in.
        case .speaking: active = !replied
        default: active = false
        }
        if active { awaitingStart = false }
        guard state == .idle else { return .none }
        replied = false
        return settle(ended: ended, chat: chat)
    }

    /// The final reply arrived (Keshab, 2026-11-06: "once one message returns it's always on"). The answer is done even while ARK
    /// reads it aloud: input is free now, and the next queued message goes at once. Sending stops the speech, as typing over ARK
    /// always did; Stop still stops it too.
    public mutating func replyDone(chat: String? = nil) -> Outcome {
        guard active else { return .none }
        active = false
        replied = true
        awaitingStart = false
        return settle(ended: true, chat: chat)
    }

    private mutating func settle(ended: Bool, chat: String?) -> Outcome {
        let elsewhere = messages.contains { chat != nil && $0.chat != chat && $0.chat != "" }
        if stop || failure || elsewhere {
            stop = false
            failure = false
            let held = takeAll()
            return held.isEmpty ? .none : .backToBox(held)
        }
        guard ended, !awaitingStart, let message = take() else { return .none }
        didDispatch()
        return .send(message)
    }

    /// Each submission keeps its own attachment limit and text. A full queue never consumes the incoming draft.
    @discardableResult public mutating func add(text: String, files: ComposerDraft, chat: String?) -> QueuedMessage? {
        guard messages.count < Self.limit, messages.allSatisfy({ $0.chat == chat }) else { return nil }
        let message = QueuedMessage(text: text, files: files, chat: chat)
        messages.append(message)
        return message
    }

    /// Wait for the submitted turn to begin before accepting its completion. This also covers Send next now.
    public mutating func didDispatch() {
        active = false
        awaitingStart = true
        stop = false
        failure = false
    }
    public mutating func stopped() { if running || !messages.isEmpty { stop = true } }
    public mutating func failed() { if running { failure = true } }

    public mutating func take(id: String? = nil) -> QueuedMessage? {
        let index = id.flatMap { wanted in messages.firstIndex { $0.id == wanted } }
        if id != nil {
            guard let index else { return nil }
            return messages.remove(at: index)
        }
        return messages.isEmpty ? nil : messages.removeFirst()
    }

    /// The persisted copies remain held for review; they are never automatically requeued.
    @discardableResult public mutating func takeAll() -> [QueuedMessage] {
        let held = messages
        messages = []
        awaitingStart = false
        return held
    }

    @discardableResult public mutating func sending(_ command: IslandCommand) -> [QueuedMessage] {
        switch command {
        case .chatOpen, .chatNew, .conversationReset: break
        case .chatDelete(let id) where messages.contains(where: { $0.chat == id }): break
        default: return []
        }
        active = false
        return takeAll()
    }
}
