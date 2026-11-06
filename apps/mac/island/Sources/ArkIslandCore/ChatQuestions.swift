import Foundation

// ADR-275 (design reference: Ghostex, MIT; redrawn in ARK's tokens): the questions card. ARK's `ask_user` tool sends each
// choice as one line: "Label | why it fits (recommended)". Here the line becomes an option row, each row gets a letter key
// (a, b, c …, then the "Other / none of these" row), and the owner's pick and note become the answer text. Pure.

public struct QuestionOption: Sendable, Equatable {
    public let label: String
    /// The dim line under the label, if the choice has one.
    public let detail: String?
    public let recommended: Bool
    /// The letter that picks it: "a" for the first.
    public let key: Character
}

public enum ChatQuestions {
    public static let keys = Array("abcdefgh")
    public static let marker = "(recommended)"
    public static let otherLabel = "Other / none of these"

    /// One option per choice line, in order, with letter keys from "a".
    public static func options(_ choices: [String]) -> [QuestionOption] {
        choices.prefix(keys.count - 1).enumerated().map { index, raw in
            var line = raw
            let recommended = line.range(of: marker, options: .caseInsensitive) != nil
            while let found = line.range(of: marker, options: .caseInsensitive) { line.removeSubrange(found) }
            let parts = line.split(separator: "|", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            let label = parts.first.flatMap { $0.isEmpty ? nil : $0 } ?? raw.trimmingCharacters(in: .whitespaces)
            let detail = parts.count > 1 && !parts[1].isEmpty ? parts[1] : nil
            return QuestionOption(label: label, detail: detail, recommended: recommended, key: keys[index])
        }
    }

    /// The letter of the "Other / none of these" row: the one after the last option.
    public static func otherKey(_ options: [QuestionOption]) -> Character { keys[min(options.count, keys.count - 1)] }

    /// The row a letter picks: an option's index, `options.count` for "Other", nil for any other key. Case does not matter.
    public static func pick(key: Character, in options: [QuestionOption]) -> Int? {
        guard !options.isEmpty, let index = keys.firstIndex(of: Character(key.lowercased())), index <= options.count else { return nil }
        return index
    }

    /// The pick after an arrow key: down from nothing picks the first row; the ends stop. Rows are the options, then "Other".
    public static func move(_ pick: Int?, by step: Int, options: [QuestionOption]) -> Int? {
        guard !options.isEmpty else { return nil }
        guard let pick else { return step > 0 ? 0 : options.count }
        return min(options.count, max(0, pick + step))
    }

    /// What the owner answers: the picked label (and the note after it), only the note for "Other" or with no pick, and nil
    /// (sent as unanswered) when nothing is picked and the note is blank. `pick == options.count` is "Other".
    public static func answer(options: [QuestionOption], pick: Int?, note: String) -> String? {
        let note = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if let pick, pick < options.count {
            return note.isEmpty ? options[pick].label : "\(options[pick].label). \(note)"
        }
        if let pick, pick == options.count, !options.isEmpty { return note.isEmpty ? "None of these" : note }
        return note.isEmpty ? nil : note
    }

    /// "1 question", "2 questions".
    public static func count(_ n: Int) -> String { n == 1 ? "1 question" : "\(n) questions" }
}
