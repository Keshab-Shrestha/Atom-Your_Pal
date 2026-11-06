import Foundation

/// ADR-274: what one chat held when the owner last viewed it. Kept on this Mac only, for Catch me up.
public struct ChatSeen: Codable, Sendable, Equatable {
    public var at: Date
    /// The chat list's message count.
    public var messages: Int
    /// Board jobs from this chat: job id → its state as the Board shows it. Nil while the Board list is not known yet.
    public var jobs: [String: String]?

    public init(at: Date, messages: Int, jobs: [String: String]?) {
        self.at = at
        self.messages = messages
        self.jobs = jobs
    }
}

/// ADR-274: does a chat hold activity from after the owner last viewed it? New messages (ARK's turns, agent reports posted in
/// the chat) and Board jobs from this chat that started or changed state count. Deterministic; no model call.
public enum ChatActivity {
    /// At most this many chats are remembered; the oldest views go first.
    public static let limit = 200

    public static func mark(chat: ChatInfo, helpers: [Helper]?, at: Date) -> ChatSeen {
        let jobs = helpers.map { list in
            Dictionary(list.flatMap(\.jobs).filter { $0.chatId == chat.id }.map { (String($0.id), "\(WorkerMark.of($0))") },
                       uniquingKeysWith: { a, _ in a })
        }
        return ChatSeen(at: at, messages: chat.messages, jobs: jobs)
    }

    /// Nothing seen before: nothing to catch up on. A job that left the Board is not news.
    public static func isNew(_ now: ChatSeen, since seen: ChatSeen?) -> Bool {
        guard let seen else { return false }
        if now.messages > seen.messages { return true }
        guard let jobs = now.jobs, let before = seen.jobs else { return false }
        return jobs.contains { before[$0.key] != $0.value }
    }

    /// The view now replaces the last one. Unknown jobs keep the last known ones. The oldest views past `limit` are dropped.
    public static func remember(_ mark: ChatSeen, for chat: String, in seen: [String: ChatSeen]) -> [String: ChatSeen] {
        var next = seen
        var mark = mark
        if mark.jobs == nil { mark.jobs = seen[chat]?.jobs }
        next[chat] = mark
        if next.count > limit {
            for old in next.sorted(by: { $0.value.at < $1.value.at }).prefix(next.count - limit).map(\.key) { next[old] = nil }
        }
        return next
    }

    /// The fixed request Catch me up sends through the normal send path.
    public static func request(since: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = calendar.timeZone
        format.dateFormat = calendar.isDate(since, inSameDayAs: now) ? "HH:mm" : "MMM d, HH:mm"
        return "Catch me up: summarise in a few lines what happened in this chat since \(format.string(from: since))."
    }
}
