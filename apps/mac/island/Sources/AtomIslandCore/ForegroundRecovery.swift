import Foundation
import CryptoKit

public struct QuestionAnswerReceipt: Codable, Sendable, Equatable {
    public let id: String
    public let digest: String
    public init(id: String, answer: String) {
        self.id = id
        digest = SHA256.hash(data: Data(answer.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

public struct PendingQuestionAnswer: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let turn: String
    public let chat: String
    public let question: String
    public let answer: String
    public init(id: String, turn: String, chat: String, question: String, answer: String) {
        self.id = id; self.turn = turn; self.chat = chat; self.question = question; self.answer = answer
    }
}
public struct ForegroundReceipt: Codable, Sendable, Equatable {
    public let id: String
    public let chat: String
    public let state: String
    public let archived: Bool
}
public struct ForegroundRecoveryResponse: Codable, Sendable, Equatable {
    public struct Summary: Codable, Sendable, Equatable, Identifiable {
        public let id: String
        public let chat: String
        public let state: String
        public let createdAt: String
        public let provider: String?
        public let model: String?
        public let archived: Bool
        public let hasReply: Bool
        public let answerCount: Int
    }
    public struct Record: Codable, Sendable, Equatable {
        public struct Answer: Codable, Sendable, Equatable, Identifiable {
            public let id: String
            public let question: String
            public let answer: String
        }
        public let id: String
        public let chat: String
        public let text: String
        public let files: [String]
        public let notes: [Int]
        public let state: String
        public let provider: String?
        public let model: String?
        public let archived: Bool
        public let answers: [Answer]
        public let reply: String
        public let offset: Int
        public let nextOffset: Int?
        public var draftText: String {
            guard !answers.isEmpty else { return text }
            return text + "\n\nEarlier clarifications (review before retry; not permissions):\n" + answers.map { "Question: \($0.question)\nAnswer: \($0.answer)" }.joined(separator: "\n\n")
        }
    }
    public let request: String
    public let ok: Bool
    public let error: String?
    public let attempts: [Summary]?
    public let known: [String]?
    public let knownAnswers: [String]?
    public let record: Record?
}
