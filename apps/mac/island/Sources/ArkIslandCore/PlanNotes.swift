import Foundation

/// ADR-276: notes on a work plan (design reference: Ghostex's plan annotations, MIT; no code taken). The owner marks a portion
/// "Looks good", "Clarify" or "Needs tests" and may add words; "Send notes" puts them all in the composer as numbered feedback.
/// Nothing is sent on its own. Notes are kept per plan on this Mac only. Pure.
public struct PlanNote: Codable, Equatable, Sendable, Identifiable {
    public enum Mark: String, Codable, CaseIterable, Sendable {
        case looksGood, clarify, needsTests
        public var title: String {
            switch self {
            case .looksGood: "Looks good"
            case .clarify: "Clarify"
            case .needsTests: "Needs tests"
            }
        }
    }

    public static let maxText = 1_000, maxQuote = 160, maxGoal = 80

    public var id: UUID
    /// The portion number (P1, P2, ...).
    public var portion: Int
    public var mark: Mark?
    public var text: String

    /// Nil when the note has neither a mark nor words.
    public init?(id: UUID = UUID(), portion: Int, mark: Mark?, text: String) {
        let clean = String(HiddenCharacters.strip(text).text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxText))
        guard mark != nil || !clean.isEmpty else { return nil }
        self.id = id
        self.portion = portion
        self.mark = mark
        self.text = clean
    }
}

/// One plan's notes, with the goal they were written for: a plan number that comes back with another goal starts empty.
public struct PlanNoteSet: Codable, Equatable, Sendable {
    public var goal: String
    public var notes: [PlanNote]
    public init(goal: String, notes: [PlanNote] = []) { self.goal = goal; self.notes = notes }
}

/// Every plan's notes, as Settings keeps them (ADR-276): no message text beyond the notes, this Mac only.
public struct PlanNoteBook: Codable, Equatable, Sendable {
    public static let maxNotesPerPlan = 50, maxPlans = 40
    public private(set) var sets: [String: PlanNoteSet] = [:]
    /// Plan keys, least recently saved first; the oldest leave beyond `maxPlans`.
    public private(set) var order: [String] = []
    public init() {}

    /// The plan's notes; none when the plan number now names another goal.
    public func notes(plan: Int, goal: String) -> [PlanNote] {
        sets[String(plan)].flatMap { $0.goal == goal ? $0.notes : nil } ?? []
    }

    /// The book with `notes` saved for the plan; no notes removes it.
    public func saving(_ notes: [PlanNote], plan: Int, goal: String) -> PlanNoteBook {
        let key = String(plan)
        var book = self
        book.order.removeAll { $0 == key }
        if notes.isEmpty {
            book.sets[key] = nil
        } else {
            book.sets[key] = PlanNoteSet(goal: goal, notes: Array(notes.prefix(Self.maxNotesPerPlan)))
            book.order.append(key)
        }
        while book.order.count > Self.maxPlans { book.sets[book.order.removeFirst()] = nil }
        return book
    }
}

public enum PlanNotes {
    /// The message the composer receives, numbered in portion order (then in the order written):
    /// `Notes on the plan "Cedar":` / `1. [Clarify] P2 — "Write the notes": Which audience?`
    public static func message(goal: String, notes: [PlanNote], portions: [PlanPortion]) -> String? {
        guard !notes.isEmpty else { return nil }
        let tasks = Dictionary(portions.map { ($0.n, $0.task) }, uniquingKeysWith: { a, _ in a })
        let ordered = notes.enumerated().sorted { ($0.element.portion, $0.offset) < ($1.element.portion, $1.offset) }.map(\.element)
        let lines = ordered.enumerated().map { index, note -> String in
            let mark = note.mark.map { "[\($0.title)] " } ?? ""
            let quote = tasks[note.portion].map { " — \"\(Self.quote($0, limit: PlanNote.maxQuote))\"" } ?? ""
            let words = note.text.isEmpty ? "" : ": " + oneLine(note.text)
            return "\(index + 1). \(mark)P\(note.portion)\(quote)\(words)"
        }
        return (["Notes on the plan \"\(quote(goal, limit: PlanNote.maxGoal))\":"] + lines).joined(separator: "\n")
    }

    /// The draft with the message after it; an existing draft keeps its text and gets a blank line first.
    public static func appending(_ message: String, to draft: String) -> String {
        let separator = draft.isEmpty || draft.hasSuffix("\n\n") ? "" : draft.hasSuffix("\n") ? "\n" : "\n\n"
        return draft + separator + message + "\n"
    }

    /// One line, double quotes made single, at most `limit` characters.
    private static func quote(_ text: String, limit: Int) -> String {
        let line = oneLine(text).replacingOccurrences(of: "\"", with: "'")
        return line.count <= limit ? line : String(line.prefix(limit - 1)) + "…"
    }

    private static func oneLine(_ text: String) -> String {
        text.split(whereSeparator: \.isNewline).joined(separator: " ").trimmingCharacters(in: .whitespaces)
    }
}
