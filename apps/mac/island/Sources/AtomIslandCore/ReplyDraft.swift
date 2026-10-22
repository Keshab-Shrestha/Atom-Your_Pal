import Foundation

public struct ReplyProfile: Codable, Sendable, Equatable {
    public var chat: String
    public var provider: String
    public var model: String
    public var effort: String
    public var fields: [String: String] { ["chat": chat, "provider": provider, "model": model, "effort": effort] }
}
public struct ReplyContextItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var text: String
    public var revision: String
    public var truncated: Bool
    public var source: BrainNoteSource?
}
public struct ReplyContextResult: Codable, Sendable, Equatable {
    public var id: String
    public var profile: ReplyProfile?
    public var items: [ReplyContextItem]
    public var error: String?
    public init(id: String, profile: ReplyProfile?, items: [ReplyContextItem], error: String?) {
        self.id = id; self.profile = profile; self.items = items; self.error = error
    }
}
public struct ReplyDraftInput: Sendable, Equatable {
    public var profile: ReplyProfile
    public var conversation: String
    public var intent: String
    public var background: String
    public var examples: String
    public var context: [ReplyContextItem]
    public init(profile: ReplyProfile, conversation: String, intent: String, background: String, examples: String, context: [ReplyContextItem]) {
        self.profile = profile; self.conversation = conversation; self.intent = intent; self.background = background; self.examples = examples; self.context = context
    }
    public var fields: [String: Any] {
        ["profile": profile.fields, "conversation": conversation, "intent": intent, "background": background, "examples": examples,
         "context": context.map { ["id": $0.id, "revision": $0.revision] }]
    }
}
public struct ReplyDraftResult: Codable, Sendable, Equatable {
    public var id: String
    public var text: String?
    public var error: String?
    public init(id: String, text: String?, error: String?) { self.id = id; self.text = text; self.error = error }
}
