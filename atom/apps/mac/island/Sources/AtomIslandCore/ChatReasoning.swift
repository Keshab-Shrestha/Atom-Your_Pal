import Foundation

/// The host's supported levels for the effective model in this exact chat.
public struct ChatReasoning: Codable, Sendable, Equatable {
    public var provider: String
    public var model: String
    public var levels: [String]
    public var `default`: String
    public var selected: String?
    public var effective: String
    public var note: String?

    public static func title(_ level: String) -> String {
        switch level {
        case "off", "none": "Off"
        case "xhigh": "Extra high"
        default: level.prefix(1).uppercased() + level.dropFirst()
        }
    }
    public var title: String { levels.isEmpty ? "Thinking unavailable" : Self.title(effective) }
    public var valid: Bool {
        levels.count <= 16 && Set(levels).count == levels.count
            && levels.allSatisfy { $0.range(of: "^[a-z][a-z0-9_-]{0,31}$", options: .regularExpression) != nil }
            && effective.count <= 32 && `default`.count <= 32 && (selected?.count ?? 0) <= 32
    }
}
