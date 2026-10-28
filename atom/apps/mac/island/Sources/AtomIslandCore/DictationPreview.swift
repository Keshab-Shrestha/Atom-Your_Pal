import Foundation

/// The live preview (ADR-050): while the user speaks, the growing recording is read again every few
/// tenths of a second and the words so far are shown on screen. Parakeet reads a whole clip at a time,
/// so this is how a preview is made without a streaming model. The typed text always comes from one
/// final pass over the whole recording, never from the preview.
public enum DictationPreview {
    /// Seconds between preview passes.
    public static let interval = 0.6
    /// Nothing is shown before this much speech has been recorded.
    public static let firstAfterSeconds = 1.0
    /// A pass is skipped unless this much new audio arrived since the last one.
    public static let newAudioSeconds = 0.4
    /// The model reads at most this much at once (Parakeet's 15 s limit); a longer recording previews its tail.
    public static let windowSeconds = 15.0
    /// Longest preview shown, in characters.
    public static let characterLimit = 40

    /// Whether to run a pass now. `total` is how much has been recorded, `lastDecoded` how much the last pass read.
    public static func shouldDecode(total: Int, lastDecoded: Int) -> Bool {
        let rate = Double(DictationAudio.sampleRate)
        return Double(total) >= firstAfterSeconds * rate
            && Double(total - lastDecoded) >= newAudioSeconds * rate
    }

    /// The preview as one short line: line breaks become spaces, and a long text keeps its end
    /// (the newest words) after an ellipsis, starting at a word boundary.
    public static func display(_ text: String, limit: Int = characterLimit) -> String {
        let flat = text.split(whereSeparator: \.isNewline).joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
        guard flat.count > limit else { return flat }
        var tail = String(flat.suffix(limit))
        // Drop the cut word, unless the cut fell exactly between words.
        let cutBetweenWords = flat[flat.index(flat.endIndex, offsetBy: -limit - 1)].isWhitespace
        if !cutBetweenWords, let space = tail.firstIndex(of: " ") { tail = String(tail[tail.index(after: space)...]) }
        return "…" + tail
    }
}
