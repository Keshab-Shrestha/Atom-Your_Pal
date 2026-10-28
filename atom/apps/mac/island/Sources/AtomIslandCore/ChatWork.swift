import Foundation

/// Foreground observations only, separate from the durable saved text and authoritative permission checks.
public struct ChatWorkSnapshot: Codable, Sendable, Equatable {
    public struct Call: Codable, Sendable, Equatable, Identifiable {
        public let id: String
        public let tool: String
        public var state: String
        public let ms: Double?
    }
    public struct Question: Codable, Sendable, Equatable, Identifiable {
        public let id: String
        public let prompt: String
        public let choices: [String]
        public var state: String
        public let answer: String?
        public let error: String?
    }
    public let chat: String
    public let turn: String
    public let startedAt: String
    public var elapsedMs: Double
    public var state: String
    public var calls: [Call]
    public let omitted: Int
    public var questions: [Question]
    private var receivedUptime = ProcessInfo.processInfo.systemUptime
    private enum CodingKeys: String, CodingKey { case chat, turn, startedAt, elapsedMs, state, calls, omitted, questions }

    public func elapsed(now: Double = ProcessInfo.processInfo.systemUptime) -> Double {
        min(86_400_000, max(0, elapsedMs + (state == "working" ? max(0, now - receivedUptime) * 1000 : 0)))
    }
    public mutating func interrupt() {
        guard state == "working" else { return }
        elapsedMs = elapsed(); state = "interrupted"
        for i in calls.indices where calls[i].state == "started" { calls[i].state = "unknown" }
        for i in questions.indices where questions[i].state == "pending" { questions[i].state = "skipped" }
    }
    public var valid: Bool {
        UUID(uuidString: turn) != nil && !chat.isEmpty && chat.count <= 100 && elapsedMs.isFinite && elapsedMs >= 0 && elapsedMs <= 86_400_000
        && ["working", "completed", "failed", "stopped"].contains(state) && calls.count <= 60 && questions.count <= 4 && omitted >= 0
        && calls.allSatisfy { UUID(uuidString: $0.id) != nil && $0.tool.count <= 100 && ["started", "ok", "error", "unknown"].contains($0.state) && ($0.ms.map { $0.isFinite && $0 >= 0 && $0 <= 86_400_000 } ?? true) }
        && questions.allSatisfy { UUID(uuidString: $0.id) != nil && $0.prompt.utf16.count <= 600 && $0.choices.count <= 4 && $0.choices.allSatisfy { $0.utf16.count <= 100 } && ["pending", "answered", "skipped", "expired"].contains($0.state) }
    }
}
