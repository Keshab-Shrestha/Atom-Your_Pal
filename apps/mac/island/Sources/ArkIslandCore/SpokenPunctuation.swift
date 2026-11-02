import Foundation

/// Spoken punctuation: "hello comma how are you question mark" becomes "hello, how are you?".
///
/// English words that are also ordinary words ("period") only count at the very end of what was said, where
/// they are almost always a command.
public enum SpokenPunctuation {

    private static let englishMarks: [(spoken: String, mark: String)] = [
        ("new paragraph", "\n\n"), ("new line", "\n"), ("newline", "\n"),
        ("question mark", "?"), ("exclamation mark", "!"), ("exclamation point", "!"),
        ("full stop", "."), ("semicolon", ";"), ("colon", ":"), ("comma", ","),
    ]

    public static func apply(to text: String) -> String {
        var result = text
        for (spoken, mark) in englishMarks { result = replace(spoken, with: mark, in: result) }
        // "period" only as the last word.
        result = result.replacingOccurrences(
            of: #"[\s,.]*\bperiod\b[\s.]*$"#, with: ".", options: [.regularExpression, .caseInsensitive])
        return tidy(result)
    }

    // MARK: Shared

    /// Replaces the spoken word (and any punctuation the engine already put around it) with the mark.
    private static func replace(_ spoken: String, with mark: String, in text: String) -> String {
        let pattern = #"[,.;:?!]*\s*(?<![\p{L}\p{N}])"# + NSRegularExpression.escapedPattern(for: spoken)
            + #"(?![\p{L}\p{N}])[,.;:?!]*"#
        // Not part of a longer word: guarded by the look-behind and look-ahead above.
        return text.replacingOccurrences(of: pattern, with: mark, options: [.regularExpression, .caseInsensitive])
    }

    /// No space before a mark, one space after, capital after . ? ! and a line break; lines trimmed.
    private static func tidy(_ text: String) -> String {
        var result = text
        result = result.replacingOccurrences(of: #"[ \t]+([,.;:?!])"#, with: "$1", options: .regularExpression)
        result = result.replacingOccurrences(of: #"[ \t]*\n[ \t]*"#, with: "\n", options: .regularExpression)
        // No rule adds a space after a mark: the transcript is already spaced, and such a rule broke "3.5", "1,000", "example.com", "a@b.com" and "U.S."
        // (code check, 2026-10-16).
        // Capitalise after a sentence mark that ends a word (followed by a space or the end) and after a line break.
        let characters = Array(result)
        var out = ""
        var capitalise = false
        for (index, character) in characters.enumerated() {
            if capitalise, character.isLetter {
                out.append(contentsOf: character.uppercased())
                capitalise = false
            } else {
                out.append(character)
                if !character.isWhitespace || character == "\n" {
                    let next = index + 1 < characters.count ? characters[index + 1] : nil
                    let endsSentence = ".?!".contains(character) && (next == nil || next!.isWhitespace)
                    capitalise = endsSentence || character == "\n"
                }
            }
        }
        return out.trimmingCharacters(in: .whitespaces)
    }
}
