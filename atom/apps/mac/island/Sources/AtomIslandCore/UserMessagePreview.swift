/// ADR-146: a display-only excerpt. The transcript remains the source for Copy, retry and model history.
public enum UserMessagePreview {
    public static let characterLimit = 600
    public static let lineLimit = 8

    /// Nil when the message fits. Character indices preserve Unicode graphemes, including CRLF line breaks.
    public static func collapsed(_ text: String) -> String? {
        var end = text.startIndex
        var characters = 0
        var lines = 1
        while end < text.endIndex, characters < characterLimit {
            if text[end].isNewline {
                if lines == lineLimit { break }
                lines += 1
            }
            characters += 1
            end = text.index(after: end)
        }
        guard end < text.endIndex else { return nil }
        return String(text[..<end]) + "…"
    }
}
