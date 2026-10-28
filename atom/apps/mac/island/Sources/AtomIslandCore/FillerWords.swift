import Foundation

/// Drops hesitation sounds ("um", "uh", "erm", "hmm") from a transcript (ADR-050).
///
/// Works word by word on the engine's raw text, before spoken punctuation is applied. When a filler ends a
/// sentence ("…I think, um.") its full stop moves to the word before it, and a word that now starts a sentence
/// gets its capital. Words that merely look like fillers ("hum", "umbrella", "her") are untouched because
/// whole words are matched.
public enum FillerWords {
    static let fillers: Set<String> = [
        "um", "umm", "ummm", "uh", "uhh", "uhhh", "uhm", "erm", "er", "err", "hmm", "hmmm", "mhm",
    ]

    private static let punctuation = CharacterSet(charactersIn: ".,;:!?\"“”‘’()[]…—-")
    private static let sentenceEnd: Set<Character> = [".", "?", "!", "…"]

    public static func remove(from text: String) -> String {
        let tokens = text.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        var out: [String] = []
        var capitaliseNext = false

        for token in tokens {
            let core = token.trimmingCharacters(in: punctuation)
            guard !core.isEmpty, fillers.contains(core.lowercased()) else {
                if capitaliseNext, let first = token.firstIndex(where: \.isLetter) {
                    out.append(token.replacingCharacters(in: first...first, with: token[first].uppercased()))
                } else {
                    out.append(token)
                }
                capitaliseNext = false
                continue
            }

            // A filler. Keep a sentence ending that came with it.
            let ending = token.filter { sentenceEnd.contains($0) }
            if out.isEmpty {
                capitaliseNext = true // it opened the text: the next word opens it now
            } else if !ending.isEmpty {
                var last = out.removeLast()
                while let end = last.last, ",;:".contains(end) { last.removeLast() }
                if let end = last.last, !sentenceEnd.contains(end) { last += String(ending.prefix(1)) }
                out.append(last)
                capitaliseNext = true
            }
        }
        return out.joined(separator: " ")
    }
}
