import Foundation

public struct SourceAnalysisProfile: Codable, Sendable, Equatable {
    public let provider: String
    public let model: String
    public let effort: String
}
public struct SourceAnalysisView: Codable, Sendable, Equatable {
    public struct Settings: Codable, Sendable, Equatable {
        public let enabled: Bool
        public let minute: Int
        public let dailyLimit: Int
        public let profile: SourceAnalysisProfile?
    }
    public struct Job: Codable, Sendable, Equatable {
        public struct Entry: Codable, Sendable, Equatable { public let id: Int }
        public let id: String
        public let state: String
        public let reason: String?
        public let message: String?
        public let profile: SourceAnalysisProfile
        public let entries: [Entry]
        public let index: Int
        public let offset: Int
        public let chunks: Int
        public let reused: Int
        public let calls: Int
        public let skipped: Int
    }
    public struct Record: Codable, Sendable, Equatable {
        public let source: String
        public let version: Int
        public let settings: Settings
        public let job: Job?
    }
    public struct Part: Codable, Sendable, Equatable, Identifiable {
        public let seq: Int
        public let note: Int
        public let title: String
        public let offset: Int
        public let end: Int
        public let checkedAt: String
        public let createdAt: String
        public let text: String
        public let profile: SourceAnalysisProfile
        public let stale: Bool
        public var id: Int { seq }
    }
    public let source: String?
    public let busy: Bool?
    public let record: Record?
    public let profile: SourceAnalysisProfile?
    public let used: Int
    public let day: String
    public let parts: [Part]
    public let next: Int?
    public let error: String?
}
public struct SourceAnalysisResponse: Codable, Sendable, Equatable {
    public let request: String
    public let view: SourceAnalysisView
}
public struct SourceAnalysisRequest: Codable, Sendable, Equatable {
    public let request: String
    public let action: String
    public var source: String?
    public var version: Int?
    public var job: String?
    public var before: Int?
    public var enabled: Bool?
    public var minute: Int?
    public var dailyLimit: Int?
    public var profile: SourceAnalysisProfile?
    public init(action: String, view: SourceAnalysisView?, enabled: Bool? = nil, minute: Int? = nil, dailyLimit: Int? = nil, before: Int? = nil) {
        request = UUID().uuidString.lowercased(); self.action = action
        if action == "get" { self.before = before; return }
        source = view?.source
        if action == "pause" || action == "resume" { job = view?.record?.job?.id }
        if action == "configure" || action == "start" { version = view?.record?.version ?? 0; profile = view?.profile }
        if action == "configure" {
            self.enabled = enabled ?? view?.record?.settings.enabled ?? false
            self.minute = minute ?? view?.record?.settings.minute ?? 120
            self.dailyLimit = dailyLimit ?? view?.record?.settings.dailyLimit ?? 3
            if self.enabled == false { profile = nil }
            else if view?.record?.settings.enabled == true { profile = view?.record?.settings.profile ?? view?.profile }
        }
    }
    public var fields: [String: Any] {
        guard let data = try? JSONEncoder().encode(self), let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return result
    }
}
