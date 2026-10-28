import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-129 (B1): the request, the selection as target, and merging the answer back into the whole text.
@Suite("Edit request (ADR-129)")
struct EditRequestTests {
    static let text = "First line.\nThe second line is long and slow.\nThird line."

    func range(of part: String, in text: String = EditRequestTests.text) -> Range<Int> {
        let r = (text as NSString).range(of: part)
        return r.location..<(r.location + r.length)
    }

    @Test func refusesWhatTheRuntimeWouldRefuse() {
        #expect(throws: EditRequestError.emptyInstruction) { try EditRequest(text: "x", instruction: "  ") }
        #expect(throws: EditRequestError.instructionTooLong) { try EditRequest(text: "x", instruction: String(repeating: "a", count: 501)) }
        #expect(throws: EditRequestError.textTooLong) { try EditRequest(text: String(repeating: "a", count: 100_001), instruction: "shorter") }
        #expect(throws: EditRequestError.emptyText) { try EditRequest(text: " \n", instruction: "shorter") }
        #expect(throws: EditRequestError.selectionOutOfRange) { try EditRequest(text: "abc", selection: 1..<9, instruction: "shorter") }
        #expect(throws: EditRequestError.selectionOutOfRange) { try EditRequest(text: "abc", selection: -1..<2, instruction: "shorter") }
    }

    @Test func noSelectionOrACaretMeansTheWholeText() throws {
        let whole = try EditRequest(text: Self.text, instruction: " make it shorter ")
        #expect(whole.target == Self.text && whole.selection == nil && whole.instruction == "make it shorter")
        #expect(whole.before.isEmpty && whole.after.isEmpty)
        let caret = try EditRequest(text: Self.text, selection: 5..<5, instruction: "shorter")
        #expect(caret.selection == nil && caret.target == Self.text)
    }

    @Test func aSelectionIsTheTargetWithContextAround() throws {
        let sel = range(of: "The second line is long and slow.")
        let r = try EditRequest(text: Self.text, selection: sel, instruction: "shorter")
        #expect(r.target == "The second line is long and slow.")
        #expect(r.before == "First line.\n" && r.after == "\nThird line.")
    }

    @Test func contextIsCutAtFourHundredCharacters() throws {
        let long = String(repeating: "word ", count: 500)
        let text = long + "TARGET" + long
        let r = try EditRequest(text: text, selection: range(of: "TARGET", in: text), instruction: "x")
        #expect(r.before.utf16.count <= EditRequest.contextCharacters && r.after.utf16.count <= EditRequest.contextCharacters)
        #expect(r.before.hasSuffix("word ") && r.after.hasPrefix("word"))
    }

    @Test func aSelectionNeverCutsThroughACharacter() throws {
        let text = "a🍎b"
        // 🍎 is two UTF-16 units at 1..<3; a selection of only its second half grows to the whole emoji.
        let r = try EditRequest(text: text, selection: 2..<3, instruction: "x")
        #expect(r.selection == 1..<3 && r.target == "🍎")
        let edge = try EditRequest(text: text, selection: 0..<2, instruction: "x")
        #expect(edge.selection == 0..<3 && edge.target == "a🍎")
    }

    @Test func theAnswerMergesBackAsChangesInPlace() throws {
        let sel = range(of: "The second line is long and slow.")
        let r = try EditRequest(text: Self.text, selection: sel, instruction: "shorter")
        let review = r.review(answer: "The second line is short.")
        #expect(review.original == Self.text)
        #expect(review.proposed == "First line.\nThe second line is short.\nThird line.")
        #expect(review.hunks.count == 1)
        #expect(review.hunks[0].oldText == "long and slow" && review.hunks[0].newText == "short")
        var done = review
        #expect(done.acceptAll() == review.proposed)
    }

    @Test func selectionAtTheStartTheMiddleAndTheEnd() throws {
        let text = "alpha beta gamma"
        for (part, answer, expected) in [("alpha", "ALPHA", "ALPHA beta gamma"), ("beta", "BETA", "alpha BETA gamma"), ("gamma", "GAMMA", "alpha beta GAMMA")] {
            let r = try EditRequest(text: text, selection: range(of: part, in: text), instruction: "x")
            #expect(r.review(answer: answer).proposed == expected)
        }
    }

    @Test func aSelectionAcrossALineBreakAndAnUnchangedAnswer() throws {
        let sel = range(of: "line.\nThe second")
        let r = try EditRequest(text: Self.text, selection: sel, instruction: "x")
        #expect(r.target == "line.\nThe second")
        #expect(r.review(answer: r.target).isUnchanged, "ATOM changed nothing")
        let whole = try EditRequest(text: Self.text, instruction: "x")
        #expect(whole.review(answer: "Everything new").proposed == "Everything new")
    }

    @Test func aSelectionWithEmojiAroundIt() throws {
        let text = "🍎 red 🍎 and 🍌 yellow"
        let r = try EditRequest(text: text, selection: range(of: "🍌 yellow", in: text), instruction: "x")
        #expect(r.target == "🍌 yellow" && r.before.hasPrefix("🍎 red"))
        #expect(r.review(answer: "🍌 ripe").proposed == "🍎 red 🍎 and 🍌 ripe")
    }
}
