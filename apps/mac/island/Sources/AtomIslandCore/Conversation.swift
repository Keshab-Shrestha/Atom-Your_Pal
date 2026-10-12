import Foundation
/// The current chat's turns, for the Conversation tab (ADR-038). The runtime keeps saved chats (ADR-091).
/// Built from the runtime's events; the runtime keeps the real conversation.
public struct Conversation: Sendable, Equatable {
    public struct Turn: Sendable, Equatable, Identifiable {
        public let id: Int
        /// What the user said.
        public var transcript: String
        /// ATOM's reply, once it arrives.
        public var reply: String?
        public var outcome: Outcome
        /// Set when the reply finished playing.
        public var timings: TurnTimings?

        public init(id: Int, transcript: String, reply: String? = nil, outcome: Outcome = .inProgress, timings: TurnTimings? = nil) {
            self.id = id
            self.transcript = transcript
            self.reply = reply
            self.outcome = outcome
            self.timings = timings
        }
    }

    public enum Outcome: Sendable, Equatable {
        case inProgress
        case answered
        /// The turn ended without a request (e.g. too short); the runtime's message.
        case notice(String)
        /// The turn failed; the runtime's message, or "Stopped" when it was cancelled.
        case failed(String)
    }

    /// Oldest first, at most `limit`; the oldest are dropped.
    public private(set) var turns: [Turn] = []
    public let limit: Int
    /// Never reused, even after a reset, so views never confuse an old turn with a new one.
    private var nextId = 1

    public init(limit: Int = 50) {
        self.limit = max(1, limit)
    }

    public var isEmpty: Bool { turns.isEmpty }

    public mutating func apply(_ event: IslandEvent) {
        switch event {
        case .transcript(let text):
            turns.append(Turn(id: nextId, transcript: text))
            nextId += 1
            if turns.count > limit { turns.removeFirst(turns.count - limit) }
        case .reply(let text):
            updateCurrent { $0.reply = text }
        case .turnComplete(let timings):
            updateCurrent {
                $0.outcome = .answered
                $0.timings = timings
            }
        case .error(let error):
            updateCurrent { $0.outcome = .failed(error.message) }
        case .notice(_, let message):
            updateCurrent { $0.outcome = .notice(message) }
        case .state(.idle):
            // The turn ended without `turn.complete`: interrupted, cancelled or failed silently.
            updateCurrent { $0.outcome = $0.reply == nil ? .failed("Stopped") : .answered }
        case .conversationReset:
            turns.removeAll()
        case .chatOpened(_, let lines):
            replay(lines)
        default:
            break
        }
    }

    /// ADR-091: shows a saved chat: each thing Keshab said with the answer that followed it.
    public mutating func replay(_ lines: [ChatLine]) {
        turns.removeAll()
        for line in lines {
            if line.fromUser {
                turns.append(Turn(id: nextId, transcript: line.text, outcome: .answered))
                nextId += 1
            } else if let last = turns.indices.last, turns[last].reply == nil {
                turns[last].reply = line.text
            }
        }
        if turns.count > limit { turns.removeFirst(turns.count - limit) }
    }

    /// Changes the latest turn if it is still in progress; otherwise does nothing.
    private mutating func updateCurrent(_ change: (inout Turn) -> Void) {
        guard let last = turns.indices.last, turns[last].outcome == .inProgress else { return }
        change(&turns[last])
    }
}

// ADR-084 (Lantern, Task 4.5): the light stays with the newest words.
extension Conversation {
    /// The newest turn keeps full brightness; older turns recede to secondary text.
    public func isLatest(_ turn: Turn) -> Bool { turn.id == turns.last?.id }
}

extension Conversation.Turn {
    /// The reply is here and the turn is still going (it is being spoken): a caret of light glows after it.
    public var isStreaming: Bool { outcome == .inProgress && reply != nil }
}

/// ADR-091: one of Keshab's chats with ATOM.
public struct ChatInfo: Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var updatedAt: Date?
    public var messages: Int
    /// ADR-098: another surface writes this chat (Telegram, the local API); the window reads it only.
    public var readOnly: Bool

    public init(id: String, title: String, updatedAt: Date? = nil, messages: Int = 0, readOnly: Bool = false) {
        self.id = id
        self.title = title
        self.updatedAt = updatedAt
        self.messages = messages
        self.readOnly = readOnly
    }

    /// The one line shown in place of the composer for a read-only chat; nil for a chat the window writes.
    public var readOnlyNotice: String? {
        guard readOnly else { return nil }
        return "Written from \(id == "telegram" ? "Telegram" : "the local API"). You can read it here."
    }
}

/// ADR-091: the chats, newest first, and the one ATOM is in now (voice and typing go to it).
public struct ChatList: Sendable, Equatable {
    public var chats: [ChatInfo]
    public var current: String
    /// ADR-097: the current chat's own model; nil when it uses the default.
    public var currentProvider: String?
    public var currentModel: String?

    /// ADR-098: the composer is off while the chat in use is read-only; this is its line. Nil: the composer works.
    public var currentReadOnlyNotice: String? { chats.first { $0.id == current }?.readOnlyNotice }

    public init(chats: [ChatInfo], current: String, currentProvider: String? = nil, currentModel: String? = nil) {
        self.chats = chats
        self.current = current
        self.currentProvider = currentProvider
        self.currentModel = currentModel
    }
}

/// ADR-091: one turn of a saved chat.
public struct ChatLine: Sendable, Equatable {
    public var fromUser: Bool
    public var text: String

    public init(fromUser: Bool, text: String) {
        self.fromUser = fromUser
        self.text = text
    }
}
