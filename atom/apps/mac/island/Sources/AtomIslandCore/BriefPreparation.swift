import Foundation

public struct BriefPreparationBudget: Sendable, Equatable {
    public let day: String
    public let used: Int
    public let limit: Int
    public init(day: String, used: Int, limit: Int) { self.day = day; self.used = used; self.limit = limit }
}

public struct PreparedBriefWork: Codable, Sendable, Equatable {
    public struct Source: Codable, Sendable, Equatable {
        public let id: String
        public let label: String
        public let text: String
        public let collectedAt: String
    }
    public struct Card: Codable, Sendable, Equatable {
        public let title: String
        public let body: String
        public let sources: [Source]
    }
    public let status: String
    public let cards: [Card]
    public let provider: String?
    public let model: String?

    public static func decode(_ value: Any?) -> PreparedBriefWork? {
        guard let value, JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value), data.count <= 24_000,
              let work = try? JSONDecoder().decode(Self.self, from: data), ["ready", "empty", "budget", "failed"].contains(work.status), work.cards.count <= 3,
              (work.status == "ready") == !work.cards.isEmpty,
              work.cards.allSatisfy({ card in
                  !card.title.isEmpty && ChatBrief.valid(card.title) && !card.body.isEmpty && ChatBrief.valid(card.body)
                    && (1...4).contains(card.sources.count) && card.sources.allSatisfy {
                        !$0.id.isEmpty && !$0.label.isEmpty && !$0.text.isEmpty && ChatBrief.valid($0.label) && ChatBrief.valid($0.text)
                    }
              }) else { return nil }
        return work
    }

    public var statusText: String {
        switch status {
        case "ready": "Suggestions from captured excerpts. Review current details before using them."
        case "empty": "No clearly supported preparation was found."
        case "budget": "Today's preparation budget is used. The plain brief is still available."
        default: "Preparation was unavailable. Review the selected sources and Claude/Codex model before trying again within your daily budget."
        }
    }
}
