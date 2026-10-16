import Foundation

// ADR-129 (upgrades.md B1): what the user asks ATOM to do to some text, and how the answer becomes a review. With a
// selection, only the selected text is the target and the rest is a little context; the answer is merged back into the
// whole text, so the review shows changes in place. Offsets are UTF-16 offsets.

public enum EditRequestError: Error, Equatable {
    case emptyInstruction
    case instructionTooLong
    case textTooLong
    case emptyText
    case selectionOutOfRange
}

public struct EditRequest: Sendable, Equatable {
    public static let maxText = 100_000
    public static let maxInstruction = 500
    /// How much text on each side of a selection goes along as context.
    public static let contextCharacters = 400

    public let text: String
    /// UTF-16 offsets, on character boundaries; nil: the whole text is the target.
    public let selection: Range<Int>?
    public let instruction: String

    public init(text: String, selection: Range<Int>? = nil, instruction: String) throws {
        let words = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { throw EditRequestError.emptyInstruction }
        guard words.count <= Self.maxInstruction else { throw EditRequestError.instructionTooLong }
        let length = text.utf16.count
        guard length <= Self.maxText else { throw EditRequestError.textTooLong }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw EditRequestError.emptyText }
        self.text = text
        self.instruction = words
        if let selection {
            guard selection.lowerBound >= 0, selection.upperBound <= length else { throw EditRequestError.selectionOutOfRange }
            // An empty selection (a caret) means the whole text; a selection never cuts through a character.
            self.selection = selection.isEmpty ? nil : Self.snapped(selection, in: text)
        } else {
            self.selection = nil
        }
    }

    /// The text ATOM rewrites: the selection, or the whole text.
    public var target: String {
        guard let selection else { return text }
        return String(decoding: Array(text.utf16)[selection], as: UTF16.self)
    }

    /// Text just before the selection (empty without one), cut at a character boundary.
    public var before: String {
        guard let selection else { return "" }
        let u = Array(text.utf16)
        let start = Self.snapDown(max(0, selection.lowerBound - Self.contextCharacters), in: text)
        return String(decoding: u[start..<selection.lowerBound], as: UTF16.self)
    }

    public var after: String {
        guard let selection else { return "" }
        let u = Array(text.utf16)
        let end = Self.snapUp(min(u.count, selection.upperBound + Self.contextCharacters), in: text)
        return String(decoding: u[selection.upperBound..<end], as: UTF16.self)
    }

    /// The whole text with the target replaced by ATOM's answer, as a review of changes in place.
    public func review(answer: String) -> EditReview {
        guard let selection else { return EditReview(original: text, proposed: answer) }
        let u = Array(text.utf16)
        let proposed = String(decoding: u[..<selection.lowerBound], as: UTF16.self) + answer + String(decoding: u[selection.upperBound...], as: UTF16.self)
        return EditReview(original: text, proposed: proposed)
    }

    // MARK: character boundaries

    /// The UTF-16 offset of every character start, and the end of the text last.
    static func boundaries(_ text: String) -> [Int] {
        var out = [0]
        var offset = 0
        for ch in text {
            offset += String(ch).utf16.count
            out.append(offset)
        }
        return out
    }

    static func snapDown(_ offset: Int, in text: String) -> Int {
        boundaries(text).last { $0 <= offset } ?? 0
    }

    static func snapUp(_ offset: Int, in text: String) -> Int {
        boundaries(text).first { $0 >= offset } ?? text.utf16.count
    }

    static func snapped(_ range: Range<Int>, in text: String) -> Range<Int> {
        let marks = boundaries(text)
        let lower = marks.last { $0 <= range.lowerBound } ?? 0
        let upper = marks.first { $0 >= range.upperBound } ?? text.utf16.count
        return lower..<upper
    }
}
