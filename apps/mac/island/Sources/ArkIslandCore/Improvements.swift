import Foundation

// ARK notices (2026-11-05; the runtime's improve.ts): notes about what goes wrong in ARK, found by counting its own log. A note holds
// numbers and short reasons, never chat text. The window shows at most three on Home; the user dismisses one or talks it through in a chat.

public struct ImprovementNote: Sendable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var evidence: String
    /// 1 minor, 3 the app stops or loses work.
    public var severity: Int
    public var why: String
    public var change: String

    public init(id: String, title: String, evidence: String, severity: Int, why: String, change: String) {
        self.id = id; self.title = title; self.evidence = evidence; self.severity = severity; self.why = why; self.change = change
    }

    /// The first message of a chat that talks the note through. The user sends it; nothing is sent by itself.
    public var chatPrompt: String {
        "ARK noticed a problem with itself: \(title). Evidence from its own log: \(evidence) A suggested reason: \(why) A suggested change: \(change)\n\nHelp me decide what to do about it. Ask me before changing anything."
    }

    /// A malformed entry is left out.
    public static func list(from value: Any?) -> [ImprovementNote] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let n = entry as? [String: Any], let id = n["id"] as? String, let title = n["title"] as? String, let evidence = n["evidence"] as? String else { return nil }
            return ImprovementNote(id: id, title: title, evidence: evidence, severity: n["severity"] as? Int ?? 1, why: n["why"] as? String ?? "", change: n["change"] as? String ?? "")
        }
    }
}

public struct ImprovementsState: Sendable, Equatable {
    public var enabled: Bool
    public var running: Bool
    public var lastRunAt: Date?
    public var notes: [ImprovementNote]

    public init(enabled: Bool = true, running: Bool = false, lastRunAt: Date? = nil, notes: [ImprovementNote] = []) {
        self.enabled = enabled; self.running = running; self.lastRunAt = lastRunAt; self.notes = notes
    }

    /// Worst first, at most three: Home never shows a wall of warnings.
    public var shown: [ImprovementNote] {
        Array(notes.sorted { $0.severity > $1.severity }.prefix(3))
    }
}
