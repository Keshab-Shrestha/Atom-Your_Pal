import Foundation

/// A message typed while ATOM answers, waiting for the answer to end (ADR-127).
public struct QueuedMessage: Sendable, Equatable {
    public var text: String
    public var files: ComposerDraft
    /// The chat it was typed in ("" for a new chat before its first answer).
    public var chat: String?

    public init(text: String, files: ComposerDraft, chat: String?) {
        self.text = text
        self.files = files
        self.chat = chat
    }
}

/// ADR-127: typing while ATOM answers no longer cuts the answer off. The message waits here and goes when the turn
/// ends; a stopped or failed turn, or leaving the chat, puts it back in the box instead.
///
/// A turn runs while the runtime is transcribing, thinking or speaking (using the Mac and waiting for an OK happen
/// inside thinking). Listening is not counted: then the microphone is Keshab's, and a typed message goes at once, as
/// before.
public struct MessageQueue: Sendable, Equatable {
    public enum Outcome: Sendable, Equatable {
        case none
        /// Send it now: the answer it waited for is done.
        case send(QueuedMessage)
        /// Not sent: back into the box of its chat.
        case backToBox(QueuedMessage)
    }

    public private(set) var next: QueuedMessage?
    public private(set) var running = false
    private var stop = false
    private var failure = false

    public init() {}

    /// The runtime's loop changed state. At idle the waiting message goes, unless the turn was stopped or failed, or
    /// `chat` (the open chat now) is another one.
    public mutating func turn(_ state: LoopState, chat: String? = nil) -> Outcome {
        running = state == .transcribing || state == .thinking || state == .speaking
        guard state == .idle else { return .none }
        let back = stop || failure
        stop = false
        failure = false
        guard let message = next else { return .none }
        next = nil
        let elsewhere = chat != nil && message.chat != chat && message.chat != ""
        return back || elsewhere ? .backToBox(message) : .send(message)
    }

    /// Adds to the waiting message: words after a blank line, files once each (5 at most, as one message).
    public mutating func add(text: String, files: ComposerDraft, chat: String?) {
        guard var message = next else {
            next = QueuedMessage(text: text, files: files, chat: chat)
            return
        }
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !words.isEmpty { message.text = message.text.isEmpty ? words : message.text + "\n\n" + words }
        message.files.add(files.files.map(\.path))
        for note in files.notes { message.files.add(note: note) }
        next = message
    }

    /// Keshab pressed Stop.
    public mutating func stopped() { if running { stop = true } }
    /// The turn ended in an error.
    public mutating func failed() { if running { failure = true } }

    /// Takes the waiting message out (Edit, or Send now).
    public mutating func take() -> QueuedMessage? {
        defer { next = nil }
        return next
    }

    /// A command about to be sent. Opening another chat, starting a new one or deleting this one cancels the answer;
    /// the waiting message is handed back to go into this chat's box, before the chat changes.
    public mutating func sending(_ command: IslandCommand) -> QueuedMessage? {
        guard let message = next else { return nil }
        switch command {
        case .chatOpen, .chatNew, .conversationReset: break
        case .chatDelete(let id) where id == message.chat: break
        default: return nil
        }
        next = nil
        return message
    }
}
