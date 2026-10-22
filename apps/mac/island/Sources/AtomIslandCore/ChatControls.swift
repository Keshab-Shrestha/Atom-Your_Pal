import Foundation

public struct ChatControlRequest: Codable, Sendable, Equatable {
    public enum Action: String, Codable, Sendable { case inspect, page, flags, fork, brief, continuity }
    public var action: Action
    public var id: String
    public var request: String
    public var revision: String?
    public var message: Int?
    public var offset: Int?
    public var through: Int?
    public var kind: String?
    public var pinned: Bool?
    public var archived: Bool?
    public var version: Int?
    public var text: String?
    public var enabled: Bool?

    public init(action: Action, id: String, request: String = UUID().uuidString, revision: String? = nil,
                message: Int? = nil, offset: Int? = nil, through: Int? = nil, kind: String? = nil,
                pinned: Bool? = nil, archived: Bool? = nil, version: Int? = nil, text: String? = nil, enabled: Bool? = nil) {
        self.action = action; self.id = id; self.request = request; self.revision = revision
        self.message = message; self.offset = offset; self.through = through; self.kind = kind
        self.pinned = pinned; self.archived = archived; self.version = version; self.text = text
        self.enabled = enabled
    }

    public var fields: [String: Any] {
        guard let data = try? JSONEncoder().encode(self), let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return fields
    }
}

public struct ChatHistoryCursor: Sendable, Equatable {
    public var message: Int
    public var offset: Int
    public init(message: Int = 1, offset: Int = 0) { self.message = message; self.offset = offset }
}

public struct ChatControlResponse: Codable, Sendable, Equatable {
    public struct Continuity: Codable, Sendable, Equatable {
        public struct Summary: Codable, Sendable, Equatable {
            public struct Item: Codable, Sendable, Equatable {
                public let text: String
                public let refs: [Int]
            }
            public let through: Int
            public let items: [Item]
            public let provider: String
            public let model: String
            public let updatedAt: String
        }
        public let enabled: Bool
        public let version: Int
        public let status: String
        public let summary: Summary?
    }
    public struct Info: Codable, Sendable, Equatable {
        public struct Access: Codable, Sendable, Equatable {
            public let provider: String
            public let hostTools: Bool
            public let project: Bool
            public let fileGrants: Int
            public let computer: Bool
            public let web: Bool
        }
        public let messages: Int
        public let archiveBytes: Int
        public let replayBytes: Int
        public let replayBudget: Int
        public let omitted: Int
        public let lastUser: Int?
        public let access: Access?
    }
    public struct Page: Codable, Sendable, Equatable {
        public struct Message: Codable, Sendable, Equatable, Identifiable {
            public let seq: Int
            public let role: String
            public let offset: Int
            public let text: String
            public var id: String { "\(seq)-\(offset)" }
        }
        public let messages: [Message]
        public let nextMessage: Int?
        public let nextOffset: Int?
        public var next: ChatHistoryCursor? { nextMessage.map { ChatHistoryCursor(message: $0, offset: nextOffset ?? 0) } }
    }
    public struct Branch: Codable, Sendable, Equatable {
        public let id: String
        public let kind: String
        public let draft: String
        public let created: Bool
    }
    public struct Metadata: Codable, Sendable, Equatable {
        public let pinned: Bool
        public let archived: Bool
        public let version: Int
        public let previousPinned: Bool
        public let previousArchived: Bool
    }
    public let action: ChatControlRequest.Action
    public let id: String
    public let request: String
    public let ok: Bool
    public let error: String?
    public let revision: String?
    public let brief: ChatBrief?
    public let continuity: Continuity?
    public let info: Info?
    public let page: Page?
    public let branch: Branch?
    public let metadata: Metadata?
}
