import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-129 (B1): the diff engine. Hunks are in UTF-16 offsets, so a text view can use them as they are.
@Suite("Text diff (ADR-129)")
struct TextDiffTests {
    /// The independent check: apply the chosen hunks to the old text by hand.
    static func apply(_ old: String, _ hunks: [DiffHunk], accepting: (DiffHunk) -> Bool) -> String {
        let o = Array(old.utf16)
        var out: [UInt16] = []
        var cursor = 0
        for h in hunks {
            out += o[cursor..<h.oldRange.lowerBound]
            out += accepting(h) ? Array(h.newText.utf16) : Array(o[h.oldRange])
            cursor = h.oldRange.upperBound
        }
        out += o[cursor...]
        return String(decoding: out, as: UTF16.self)
    }

    static func check(_ old: String, _ new: String, sourceLocation: SourceLocation = #_sourceLocation) {
        let hunks = TextDiff.hunks(old: old, new: new)
        #expect(Self.apply(old, hunks, accepting: { _ in true }) == new, "accept all is the new text", sourceLocation: sourceLocation)
        #expect(Self.apply(old, hunks, accepting: { _ in false }) == old, "deny all is the old text", sourceLocation: sourceLocation)
        let o = Array(old.utf16)
        let n = Array(new.utf16)
        var oldEnd = 0
        for h in hunks {
            #expect(h.oldRange.lowerBound >= oldEnd && h.oldRange.upperBound <= o.count, "ordered, inside the old text", sourceLocation: sourceLocation)
            #expect(h.newRange.upperBound <= n.count, sourceLocation: sourceLocation)
            #expect(h.oldText == String(decoding: o[h.oldRange], as: UTF16.self), sourceLocation: sourceLocation)
            #expect(h.newText == String(decoding: n[h.newRange], as: UTF16.self), sourceLocation: sourceLocation)
            #expect(!(h.oldRange.isEmpty && h.newRange.isEmpty), "a hunk changes something", sourceLocation: sourceLocation)
            oldEnd = h.oldRange.upperBound
        }
        #expect(hunks.map(\.id) == Array(hunks.indices), "ids are the positions", sourceLocation: sourceLocation)
    }

    @Test func identicalTextsHaveNoHunks() {
        #expect(TextDiff.hunks(old: "same\ntext", new: "same\ntext").isEmpty)
        #expect(TextDiff.hunks(old: "", new: "").isEmpty)
    }

    @Test func anInsertionAndADeletionOfWholeLines() {
        let inserted = TextDiff.hunks(old: "a\nc\n", new: "a\nb\nc\n")
        #expect(inserted.count == 1)
        #expect(inserted[0].oldText == "" && inserted[0].newText == "b\n")
        #expect(inserted[0].oldRange == 2..<2 && inserted[0].newRange == 2..<4)
        let deleted = TextDiff.hunks(old: "a\nb\nc\n", new: "a\nc\n")
        #expect(deleted.count == 1)
        #expect(deleted[0].oldText == "b\n" && deleted[0].newText == "")
        Self.check("a\nc\n", "a\nb\nc\n")
        Self.check("a\nb\nc\n", "a\nc\n")
    }

    @Test func aReplacedLineShowsTheChangedWordsOnly() {
        let hunks = TextDiff.hunks(old: "Buy milk today\nCall Sam\n", new: "Buy oat milk today\nCall Sam\n")
        #expect(hunks.count == 1)
        #expect(hunks[0].oldText == "" && hunks[0].newText.trimmingCharacters(in: .whitespaces) == "oat", "the word, with one space")
        let swap = TextDiff.hunks(old: "The quick brown fox", new: "The slow brown fox")
        #expect(swap.count == 1 && swap[0].oldText == "quick" && swap[0].newText == "slow")
        Self.check("Buy milk today\nCall Sam\n", "Buy oat milk today\nCall Sam\n")
        Self.check("The quick brown fox", "The slow brown fox")
    }

    @Test func changesSeparatedOnlyByASpaceAreOne() {
        let hunks = TextDiff.hunks(old: "one two three", new: "uno dos three")
        #expect(hunks.count == 1)
        #expect(hunks[0].oldText == "one two" && hunks[0].newText == "uno dos")
    }

    @Test func movedLinesAreADeleteAndAnInsert() {
        Self.check("a\nb\nc\nd\n", "d\nb\nc\na\n")
        Self.check("a\nb\nc\n", "c\nb\na\n")
    }

    @Test func trailingNewlinesAndEmptyTexts() {
        Self.check("a\nb", "a\nb\n")
        Self.check("a\nb\n", "a\nb")
        Self.check("", "new text\n")
        Self.check("old text\n", "")
        Self.check("\n\n", "\n")
        Self.check("a\r\nb\r\n", "a\r\nc\r\n")
    }

    @Test func emojiAndJapaneseAreNeverSplit() {
        Self.check("今日は天気がいいですね。\nありがとう", "今日は天気が悪いですね。\nありがとうございます")
        Self.check("I like 🍎 and 👨‍👩‍👧‍👦 very much", "I like 🍌 and 👨‍👩‍👧‍👦 very much")
        Self.check("🍎", "🍎🍎")
        let family = "👨‍👩‍👧‍👦"
        let hunks = TextDiff.hunks(old: "a \(family) b", new: "a \(family)\(family) b")
        for h in hunks {
            // every offset is on a character boundary of its text
            #expect(EditRequest.boundaries("a \(family) b").contains(h.oldRange.lowerBound))
            #expect(EditRequest.boundaries("a \(family) b").contains(h.oldRange.upperBound))
        }
    }

    @Test func randomEditsAlwaysRoundTrip() {
        var seed: UInt64 = 42
        func next(_ n: Int) -> Int {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Int((seed >> 33) % UInt64(n))
        }
        let words = ["alpha", "beta", "gamma", "delta", "今日", "天気", "🍎", "x", "the", "a"]
        func text() -> String {
            (0..<next(8)).map { _ in (0..<(1 + next(5))).map { _ in words[next(words.count)] }.joined(separator: next(5) == 0 ? "" : " ") }.joined(separator: next(6) == 0 ? "\r\n" : "\n")
        }
        for _ in 0..<200 {
            let old = text()
            let new = next(3) == 0 ? text() : old.replacingOccurrences(of: words[next(words.count)], with: words[next(words.count)])
            Self.check(old, new)
        }
    }

    @Test func aLargeTextWithAFewEditsIsFast() {
        let lines = (0..<2_000).map { "Line \($0): the quick brown fox jumps over the lazy dog" }
        var changed = lines
        for i in stride(from: 50, to: 2_000, by: 100) { changed[i] = "Line \(i): the slow brown fox jumps over the lazy cat" }
        let old = lines.joined(separator: "\n")
        let new = changed.joined(separator: "\n")
        #expect(old.utf16.count > 100_000)
        let start = Date()
        let hunks = TextDiff.hunks(old: old, new: new)
        #expect(Date().timeIntervalSince(start) < 3)
        #expect(hunks.count == 40, "two words change on each of 20 lines, and the words between them stay")
        #expect(Self.apply(old, hunks, accepting: { _ in true }) == new)
    }

    @Test func aWholeNewTextIsOneChangeNotAMillionSteps() {
        let old = (0..<3_000).map { "old \($0)" }.joined(separator: "\n")
        let new = (0..<3_000).map { "new line \($0 * 7)" }.joined(separator: "\n")
        let start = Date()
        let hunks = TextDiff.hunks(old: old, new: new)
        #expect(Date().timeIntervalSince(start) < 5)
        #expect(Self.apply(old, hunks, accepting: { _ in true }) == new)
    }

    @Test func aTextOverFiveThousandLinesIsComparedByLines() {
        let old = (0..<5_100).map { "row \($0)" }.joined(separator: "\n")
        var rows = (0..<5_100).map { "row \($0)" }
        rows[10] = "row ten"
        let hunks = TextDiff.hunks(old: old, new: rows.joined(separator: "\n"))
        #expect(hunks.count == 1)
        #expect(hunks[0].oldText == "row 10\n" && hunks[0].newText == "row ten\n", "whole lines, no words")
    }
}
