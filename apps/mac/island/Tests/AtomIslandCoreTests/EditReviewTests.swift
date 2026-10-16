import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-129 (B1): accept and deny one change at a time; accept applies at once; undo takes it back.
@Suite("Edit review (ADR-129)")
struct EditReviewTests {
    static let original = "Dear Sam,\nThanks for the long and detailed message.\nSee you soon.\n"
    static let proposed = "Dear Sam,\nThanks for the message.\nSee you very soon.\n"

    @Test func nothingIsDecidedAtFirst() {
        let r = EditReview(original: Self.original, proposed: Self.proposed)
        #expect(r.hunks.count == 2)
        #expect(r.pending.count == 2 && !r.isSettled && !r.canUndo)
        #expect(r.result == Self.original, "an unanswered change is not applied")
    }

    @Test func acceptAppliesAtOnceAndDenyKeepsTheOriginal() {
        var r = EditReview(original: Self.original, proposed: Self.proposed)
        let first = r.hunks[0].id
        let second = r.hunks[1].id
        #expect(r.accept(first) == "Dear Sam,\nThanks for the message.\nSee you soon.\n")
        #expect(r.deny(second) == "Dear Sam,\nThanks for the message.\nSee you soon.\n")
        #expect(r.isSettled && r.pending.isEmpty)
        #expect(r.decisions == [first: .accepted, second: .denied])
    }

    @Test func acceptAllIsTheProposalAndDenyAllIsTheOriginal() {
        var all = EditReview(original: Self.original, proposed: Self.proposed)
        #expect(all.acceptAll() == Self.proposed)
        var none = EditReview(original: Self.original, proposed: Self.proposed)
        #expect(none.denyAll() == Self.original)
        #expect(all.isSettled && none.isSettled)
    }

    @Test func aChangeIsAnsweredOnce() {
        var r = EditReview(original: Self.original, proposed: Self.proposed)
        let id = r.hunks[0].id
        r.accept(id)
        r.deny(id)
        #expect(r.decisions[id] == .accepted, "the first answer stands; use undo")
        let unknown = r.accept(99)
        #expect(unknown == r.result)
        #expect(!r.decisions.keys.contains(99))
    }

    @Test func undoTakesBackOneStepAtATime() {
        var r = EditReview(original: Self.original, proposed: Self.proposed)
        r.accept(r.hunks[0].id)
        r.acceptAll()
        #expect(r.result == Self.proposed)
        #expect(r.undo() == "Dear Sam,\nThanks for the message.\nSee you soon.\n", "Accept all was one step")
        #expect(r.pending.count == 1)
        #expect(r.undo() == Self.original)
        #expect(r.undo() == nil && !r.canUndo)
    }

    @Test func aStepThatChangedNothingIsNotAnUndoStep() {
        var r = EditReview(original: Self.original, proposed: Self.proposed)
        r.denyAll()
        r.acceptAll()
        r.accept(0)
        #expect(r.result == Self.original)
        #expect(r.undo() == Self.original)
        #expect(r.undo() == nil)
    }

    @Test func sameTextIsUnchanged() {
        var r = EditReview(original: "same", proposed: "same")
        #expect(r.isUnchanged && r.isSettled && r.hunks.isEmpty)
        #expect(r.acceptAll() == "same")
        #expect(!r.canUndo)
    }

    @Test func nextAndPreviousSkipAnsweredChanges() {
        var r = EditReview(original: "a\nb\nc\nd\ne\n", proposed: "A\nb\nC\nd\nE\n")
        #expect(r.hunks.count == 3)
        #expect(r.nextPending(after: nil)?.id == 0)
        #expect(r.nextPending(after: 0)?.id == 1)
        #expect(r.nextPending(after: 2)?.id == 0, "wraps round")
        #expect(r.previousPending(before: 0)?.id == 2)
        r.accept(1)
        #expect(r.nextPending(after: 0)?.id == 2)
        #expect(r.previousPending(before: 2)?.id == 0)
        r.acceptAll()
        #expect(r.nextPending(after: nil) == nil && r.previousPending(before: nil) == nil)
    }

    @Test func randomMixesUseOnlyPiecesOfTheOriginalAndTheProposal() {
        var seed: UInt64 = 9
        func next(_ n: Int) -> Int {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Int((seed >> 33) % UInt64(n))
        }
        let words = ["one", "two", "three", "four", "今日", "🍎", "five"]
        func text() -> String { (0..<(2 + next(6))).map { _ in (0..<(1 + next(4))).map { _ in words[next(words.count)] }.joined(separator: " ") }.joined(separator: "\n") }
        for _ in 0..<200 {
            let old = text()
            let new = text()
            var r = EditReview(original: old, proposed: new)
            var accepted: [Int] = []
            for h in r.hunks {
                if next(2) == 0 {
                    r.accept(h.id)
                    accepted.append(h.id)
                } else {
                    r.deny(h.id)
                }
            }
            let expected = TextDiffTests.apply(old, r.hunks) { accepted.contains($0.id) }
            #expect(r.result == expected)
            #expect(r.isSettled)
        }
    }
}
