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

/// "Fix it" (ADR-240): the first message of a project chat in ARK's own source folder. The user reads it and sends it. The chat's agent works on its
/// own branch (`ark/task-N`), so nothing lands in the main copy; the user reviews the diff and pushes. A branch that changes a file that guards ARK
/// (permissions, approvals, safety, the sandbox, updating, dependencies, this loop) is not pushed from the window at all.
public enum FixPrompt {
    public static let protectedAreas = "security, permission, approval, safety, sandbox, credential and policy code; the update, install and build scripts; package and lock files; CI files; the app's entitlements; and the code of this notices loop, the Apps sandbox and the Git push"

    public static func text(for note: ImprovementNote) -> String {
        """
        Fix a problem ARK found in itself. This chat is in ARK's own source folder.

        Problem: \(note.title)
        Evidence from ARK's log: \(note.evidence)
        Likely reason: \(note.why)
        Suggested change: \(note.change)

        How to work:
        1. Read the code first and find the cause. If the suggestion is wrong, say so.
        2. Hand the change to a coding agent, so it lands on its own branch. Do not edit the main copy.
        3. Make the smallest change that fixes it, and add or update a test that fails without it.
        4. Run `pnpm typecheck` and `pnpm test` (and `pnpm island:test` for Swift). Report what failed, if anything.
        5. Do not change: \(protectedAreas). A branch that touches them is not pushed by ARK; if the fix needs one, stop and tell me why.
        6. Do not push or merge. Report the branch name and what changed, and I will review it.
        """
    }
}
