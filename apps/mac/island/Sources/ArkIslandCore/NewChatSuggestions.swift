import Foundation

/// What a new chat offers under its box (2026-11-02, after the Codex reference Keshab chose): taken from his own work, not canned examples.
/// The most recent other chat to continue, then a task that waits or runs, newest first. At most `limit`.
public enum NewChatSuggestions {
    public enum Action: Sendable, Equatable { case openChat(String), openTask(Int) }
    public struct Item: Sendable, Equatable, Identifiable {
        public let id: String
        public let title: String
        public let detail: String
        public let action: Action
    }

    public static func items(chats: [ChatInfo], current: String?, project: String?, helpers: [Helper], limit: Int = 3) -> [Item] {
        var out: [Item] = []
        let recent = chats.filter { $0.id != current && !$0.archived && $0.messages > 0 && (project == nil || $0.projectId == project) }
            .sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
        if let chat = recent.first {
            out.append(Item(id: "chat-\(chat.id)", title: "Continue \u{201C}\(chat.title)\u{201D}", detail: "Your last chat", action: .openChat(chat.id)))
        }
        let open = helpers.flatMap { h in h.jobs.filter { $0.state.isActive }.map { (h, $0) } }
            .sorted { ($0.1.createdAt ?? .distantPast) > ($1.1.createdAt ?? .distantPast) }
        for (helper, job) in open.prefix(limit) {
            out.append(Item(id: "task-\(job.id)", title: job.title ?? job.task, detail: "\(helper.name) · \(job.state == .queued ? "waiting" : "working")", action: .openTask(job.id)))
        }
        if let second = recent.dropFirst().first, out.count < limit {
            out.append(Item(id: "chat-\(second.id)", title: "Continue \u{201C}\(second.title)\u{201D}", detail: "Earlier chat", action: .openChat(second.id)))
        }
        return Array(out.prefix(limit))
    }
}
