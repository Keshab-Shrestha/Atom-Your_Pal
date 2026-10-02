/// The current session's turns, for the Conversation tab (ADR-038). Session-only: never stored (ADR-030).
/// Built from the runtime's events; the runtime keeps the real conversation.
public struct Conversation: Sendable, Equatable {
    public struct Turn: Sendable, Equatable, Identifiable {
        public let id: Int
        /// What the user said.
        public var transcript: String
        /// ZENO's reply, once it arrives.
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
        default:
            break
        }
    }

    /// Changes the latest turn if it is still in progress; otherwise does nothing.
    private mutating func updateCurrent(_ change: (inout Turn) -> Void) {
        guard let last = turns.indices.last, turns[last].outcome == .inProgress else { return }
        change(&turns[last])
    }
}
