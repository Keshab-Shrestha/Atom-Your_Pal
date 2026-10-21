import Foundation

public enum ChatAccessMode: String, Codable, Sendable, CaseIterable {
    case checked
    case chatOnly = "chat-only"
    case askChanges = "ask-changes"

    public var title: String {
        switch self {
        case .checked: "Saved permissions"
        case .chatOnly: "Chat only"
        case .askChanges: "Ask before changes"
        }
    }
    public var detail: String {
        switch self {
        case .checked: "Use existing checked tools and saved file permissions."
        case .chatOnly: "Use conversation and saved brief only; no tools or new file or screen reads."
        case .askChanges: "Ask for each change-capable call, including edits to previously allowed files."
        }
    }
}
