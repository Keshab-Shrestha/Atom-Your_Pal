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
    /// While the owner stays in the chat, a view with the same messages and jobs keeps the stored one (no write for a new time
    /// only); `leaving` stores it regardless, so the time names when the owner left.
    public static func remember(_ mark: ChatSeen, for chat: String, in seen: [String: ChatSeen], leaving: Bool = false) -> [String: ChatSeen] {
        var next = seen
        var mark = mark
        if mark.jobs == nil { mark.jobs = seen[chat]?.jobs }
        if !leaving, let old = seen[chat], old.messages == mark.messages, old.jobs == mark.jobs { return seen }
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

/// ADR-274: is the current chat on screen? Composers that show it, while the ARK window is open. The window is kept in memory
/// when it closes, so its composer does not go away: closing pauses the view, and opening on the chat page resumes it.
public struct ChatViewing: Sendable, Equatable {
    public enum Step: Sendable, Equatable { case none, arrive, leave }
    public private(set) var composers = 0
    public private(set) var hidden = false
    public var isOn: Bool { composers > 0 && !hidden }

    public init() {}

    /// A composer appeared, so the window shows it.
    public mutating func composerAppeared() -> Step {
        let was = isOn
        composers += 1
        hidden = false
        return was ? .none : .arrive
    }

    public mutating func composerGone() -> Step {
        guard composers > 0 else { return .none }
        let was = isOn
        composers -= 1
        return was && !isOn ? .leave : .none
    }

    public mutating func windowClosed() -> Step {
        let was = isOn
        hidden = true
        return was ? .leave : .none
    }

    /// On another page the old composer goes soon; a new composer resumes the view when it appears.
    public mutating func windowOpened(onChat: Bool) -> Step {
        guard onChat, hidden else { return .none }
        hidden = false
        return isOn ? .arrive : .none
    }
}
