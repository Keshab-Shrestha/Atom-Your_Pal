import Foundation

/// ADR-149: a narrow display-control cleanup, not a prompt-injection or authorization boundary.
public enum HiddenCharacters {
    public struct Result: Sendable, Equatable {
        public let text: String
        public let removed: Int
    }

    public static func strip(_ text: String) -> Result {
        var output = String.UnicodeScalarView()
        var removed = 0
        for character in text {
            let scalars = character.unicodeScalars
            // Keep tagged flag emoji, joiners/non-joiners and variation selectors intact.
            let flag = scalars.first?.value == 0x1F3F4 && scalars.last?.value == 0xE007F
            for scalar in scalars {
                let value = scalar.value
                let hidden = value == 0 || value == 0x061C || value == 0x200B
                    || value == 0x200E || value == 0x200F || value == 0x2060 || value == 0xFEFF
                    || (0x202A...0x202E).contains(value) || (0x2066...0x2069).contains(value)
                    || (!flag && (value == 0xE0001 || (0xE0020...0xE007F).contains(value)))
                if hidden { removed += 1 } else { output.append(scalar) }
            }
        }
        return Result(text: String(output), removed: removed)
    }
}

/// ADR-151: quote only a bounded excerpt, while preserving the user's existing draft exactly.
public enum ComposerQuote {
    public static func appending(_ reply: String, to draft: String) -> String? {
        let clean = HiddenCharacters.strip(reply).text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return nil }
        let excerpt = UserMessagePreview.collapsed(clean) ?? clean
        let quote = excerpt.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline)
            .map { "> " + $0 }.joined(separator: "\n")
        let separator = draft.isEmpty || draft.hasSuffix("\n\n") ? "" : draft.hasSuffix("\n") ? "\n" : "\n\n"
        let result = draft + separator + quote + "\n\n"
        return result
    }
}
