import Foundation

public struct LocalBackupConfig: Codable, Sendable, Equatable {
    public let endpoint: String
    public let model: String
    public init(endpoint: String, model: String) { self.endpoint = endpoint; self.model = model }
}
public struct LocalBackupResponse: Codable, Sendable, Equatable {
    public struct Turn: Codable, Sendable, Equatable {
        public let role: String
        public let content: String
    }
    public struct Readiness: Codable, Sendable, Equatable {
        public let checkedAt: String
        public let durationMs: Int
        public let listed: Bool
        public let textVerified: Bool
    }
    public struct Usage: Codable, Sendable, Equatable {
        public let input: Int?
        public let output: Int?
        public let durationMs: Int
        public let truncated: Bool
    }
    public let request: String
    public let session: String
    public let revision: String
    public let config: LocalBackupConfig?
    public let turns: [Turn]
    public let readiness: Readiness?
    public let usage: Usage?
    public let error: String?
    public let completed: Bool?
}
public struct LocalBackupRequest: Codable, Sendable, Equatable {
    public let request: String
    public let session: String
    public let action: String
    public let revision: String?
    public let config: LocalBackupConfig?
    public let text: String?
    public let target: String?
    public init(session: String, action: String, revision: String? = nil, config: LocalBackupConfig? = nil, text: String? = nil, target: String? = nil) {
        request = UUID().uuidString.lowercased(); self.session = session; self.action = action
        self.revision = revision; self.config = config; self.text = text; self.target = target
    }
    public var fields: [String: Any] {
        guard let data = try? JSONEncoder().encode(self), let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return fields
    }
}
