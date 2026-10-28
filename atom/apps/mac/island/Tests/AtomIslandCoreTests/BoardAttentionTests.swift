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

    /// 2026-10-16 (code review): a failed task was counted twice (as an ask and as a failure), so one failure showed "1 ask · 1 failed" and a badge of 2.
    @Test func aFailedTaskIsCountedOnceNotAsAnAskToo() throws {
        let line = #"{"type":"helpers","apps":[],"helpers":[{"id":"sid","name":"Sid","role":"researcher","available":true,"soul":{"name":"Sid","personality":"p","howItWorks":"h","rules":"r","lessons":""},"jobs":[{"id":4,"task":"find kits","state":"failed","error":"It could not run.","createdAt":"2026-10-16T01:00:00.000Z"}]}]}"#
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        let list = try #require(state.list)
        #expect(NeedsYouItem.all(in: list).contains { $0.kind == .failed }, "notifications still see it")
        let attention = BoardAttention(list: list, approvalPending: false)
        #expect(attention.asks == 0, "it is not something to answer")
        #expect(attention.failed == 1)
        #expect(attention.total == 1, "one failure, one on the badge")
        #expect(attention.rowText == "1 failed")
    }
}

