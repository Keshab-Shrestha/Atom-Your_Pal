import Foundation

/// ADR-271: the name ARK calls its owner. Asked on first run, editable in Settings → General, sent to the runtime
/// (`owner.set`) for ARK's prompts. Pure.
public enum OwnerName {
    /// The longest name kept; the runtime cuts at the same length.
    public static let maxLength = 60

    /// One line, no control characters, at most `maxLength` characters. Nil when nothing is left.
    public static func clean(_ text: String) -> String? {
        let flat = String(String.UnicodeScalarView(text.unicodeScalars.map {
            CharacterSet.controlCharacters.contains($0) || CharacterSet.newlines.contains($0) ? " " : $0
        }))
        let words = flat.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let name = String(words.prefix(maxLength)).trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? nil : name
    }

    /// First run: no name was ever saved.
    public static func needsAsking(saved: String?) -> Bool { saved == nil }

    /// The name ARK uses: the saved one, else the Mac user's first name. Nil when there is neither.
    public static func known(saved: String?, fullUserName: String) -> String? {
        if let saved, let name = clean(saved) { return name }
        return clean(fullUserName).flatMap { $0.split(separator: " ").first.map(String.init) }
    }

    /// For text on screen: the known name, else "you".
    public static func display(saved: String?, fullUserName: String) -> String {
        known(saved: saved, fullUserName: fullUserName) ?? "you"
    }
}
