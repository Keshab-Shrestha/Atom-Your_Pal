import Foundation
import Testing
@testable import AtomIslandCore

/// 2026-10-15 (ADR-116): the sidebar's Board row and the Needs you tab read one count.
@Suite("Board attention")
struct BoardAttentionTests {
    @Test func theRowTextIsShortAndSaysWhatMattersMost() {
        #expect(BoardAttention(asks: 3, failed: 0, running: 2).rowText == "3 need you")
        #expect(BoardAttention(asks: 1, failed: 0).rowText == "1 needs you")
        #expect(BoardAttention(asks: 0, failed: 2, running: 1).rowText == "2 failed")
        #expect(BoardAttention(asks: 3, failed: 2).rowText == "3 ask · 2 failed")
        #expect(BoardAttention(asks: 0, failed: 0, running: 4).rowText == "4 running")
        #expect(BoardAttention().rowText == "Every task")
        // Never longer than the row can show.
        #expect(BoardAttention(asks: 99, failed: 99).rowText.count <= 20)
    }

    @Test func theTotalIsWhatWaits() {
        #expect(BoardAttention(asks: 3, failed: 2, running: 9).total == 5)
        #expect(!BoardAttention(asks: 0, failed: 0, running: 9).needsYou)
        #expect(BoardAttention(asks: 0, failed: 1).needsYou)
        #expect(BoardAttention(asks: 3, failed: 2, running: 1).detail == "3 to answer, 2 failed, 1 running")
    }

    @Test func aClickOpensNeedsYouWhenAnythingWaits() {
        #expect(BoardAttention(asks: 1).view(whenOpening: .floor) == .needsYou)
        #expect(BoardAttention(failed: 1).view(whenOpening: .columns) == .needsYou, "a failed task waits for Keshab too")
        #expect(BoardAttention(running: 3).view(whenOpening: .columns) == .columns, "nothing waits: the view in use stays")
        #expect(BoardAttention().view(whenOpening: .overview) == .overview)
    }

    @Test func itReadsTheListAndAnApprovalAsk() {
        #expect(BoardAttention(list: nil, approvalPending: false) == BoardAttention())
        #expect(BoardAttention(list: nil, approvalPending: true).asks == 1, "ATOM's own ask counts")
    }
}
