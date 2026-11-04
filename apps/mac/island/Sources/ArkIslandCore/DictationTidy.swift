import Foundation

// Tidy with ARK (2026-11-04, idea from atticus-mac "dictation clean-up with a deterministic validator"). After the speech model
// writes the words, ARK may ask a small model to fix punctuation, capital letters and obvious slips. A model can also change what
// was said, so its answer is used only when this plain-code check says it kept the meaning: the same numbers, almost all of the same
// words, nothing new that looks like a number, address or link. Anything else falls back to the words as spoken.

public enum DictationTidy {
    /// Fewer words than this are typed as spoken: nothing to tidy, and a model call is not worth the wait.
    public static let minimumWords = 6
    /// How long the dictation waits for the model before it types the words as spoken.
    public static let waitSeconds = 4.0

    public static let instruction =
        "Tidy this dictated text: fix punctuation, capital letters and obvious speech-to-text slips. Keep every word, name and number the speaker said, in the same order. Do not add, remove, translate or reword anything. Reply with the text only."

    /// Whether `tidy` may replace `raw`. Pure.
    public static func accepts(raw: String, tidy: String) -> Bool {
        let before = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let after = tidy.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !after.isEmpty, after != before else { return false }
        // Length stays near the original: punctuation and capitals only add a little.
        guard Double(after.count) <= Double(before.count) * 1.3 + 12, Double(after.count) >= Double(before.count) * 0.7 else { return false }
        // Numbers: the same digit groups, no new ones.
        guard numbers(in: before) == numbers(in: after) else { return false }
        // No new link, address or handle.
        for marker in ["http", "www.", "@", "://"] where after.lowercased().contains(marker) && !before.lowercased().contains(marker) { return false }
        // Words: almost all of the spoken words survive. A new word must be a slip fix: close in spelling to a spoken word that went
        // ("their" for "there", "its" for "it's"), never a different word ("someone" for "sarah").
        let spoken = words(in: before), tidied = words(in: after)
        guard !spoken.isEmpty else { return false }
        let kept = spoken.filter { tidied.contains($0) }.count
        guard Double(kept) / Double(spoken.count) >= 0.85 else { return false }
        var gone = spoken.filter { !tidied.contains($0) }
        for word in tidied where !spoken.contains(word) {
            guard let near = gone.firstIndex(where: { distance($0, word) <= (min($0.count, word.count) >= 5 ? 2 : 1) }) else { return false }
            gone.remove(at: near)
        }
        return true
    }

    /// Edit distance between two words.
    static func distance(_ a: String, _ b: String) -> Int {
        let x = Array(a), y = Array(b)
        var row = Array(0...y.count)
        for i in 1...max(1, x.count) where !x.isEmpty {
            var previous = row[0]
            row[0] = i
            for j in 1...max(1, y.count) where !y.isEmpty {
                let saved = row[j]
                row[j] = min(row[j] + 1, row[j - 1] + 1, previous + (x[i - 1] == y[j - 1] ? 0 : 1))
                previous = saved
            }
        }
        return x.isEmpty ? y.count : y.isEmpty ? x.count : row[y.count]
    }

    static func words(in text: String) -> [String] {
        text.lowercased().replacingOccurrences(of: #"(?<=\d),(?=\d)"#, with: "", options: .regularExpression).split { !($0.isLetter || $0.isNumber || $0 == "'" || $0 == "’") }.map(String.init)
    }

    /// Digit groups, with thousands commas and spaces dropped: "1,200" and "1200" are the same number.
    static func numbers(in text: String) -> [String] {
        let squeezed = text.replacingOccurrences(of: ",", with: "")
        var groups: [String] = [], current = ""
        for ch in squeezed {
            if ch.isNumber || (ch == "." && !current.isEmpty) { current.append(ch) }
            else if !current.isEmpty { groups.append(current.trimmingCharacters(in: CharacterSet(charactersIn: "."))); current = "" }
        }
        if !current.isEmpty { groups.append(current.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
        return groups.filter { !$0.isEmpty }
    }
}
