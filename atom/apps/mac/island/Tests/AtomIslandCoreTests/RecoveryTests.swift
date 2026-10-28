import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Interrupted attempts and retry identity")
struct RecoveryTests {
    @Test func recoveredAttemptRetainsItsLastStepAndNeedsReview() throws {
        let line = #"{"type":"helpers","apps":[],"helpers":[{"id":"kame","name":"Kame","available":true,"jobs":[{"id":1,"task":"Finish Cedar draft","state":"failed","createdAt":"2026-10-18T01:00:00Z","recoveryNeeded":true,"step":"Saved partial draft","error":"Outcome unconfirmed. Files may already have changed."}]}]}"#
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        let list = try #require(state.list)
        let job = try #require(list.item(1)?.job)
        #expect(job.recoveryNeeded)
        #expect(job.step == "Saved partial draft")
        #expect(job.badge == "Interrupted")
        #expect(BoardAttention(list: list, approvalPending: false).failed == 1)
        #expect(TeamIssues.all(in: list).count == 1)
        #expect(state.retry(1) != nil)
    }

    @Test func anOldAttemptLinksToItsRetryAndDoesNotKeepAskingForAnother() throws {
        let line = #"{"type":"helpers","apps":[],"helpers":[{"id":"kame","name":"Kame","available":true,"jobs":[{"id":1,"task":"Cedar draft","state":"failed","createdAt":"2026-10-18T01:00:00Z","recoveryNeeded":true,"retriedAs":2},{"id":2,"task":"Cedar draft","state":"running","createdAt":"2026-10-18T01:02:00Z","retryOf":1}]}]}"#
        var state = HelpersState()
        state.apply(try decodeEvent(line))
        let list = try #require(state.list)
        let old = try #require(list.item(1)?.job)
        #expect(old.badge == "Retried")
        #expect(BoardColumn.of(old) == .done)
        #expect(list.item(2)?.job.retryOf == 1)
        #expect(TeamIssues.all(in: list).isEmpty)
        #expect(!NeedsYouItem.all(in: list).contains { $0.kind == .failed })
        #expect(BoardAttention(list: list, approvalPending: false).failed == 0)
        #expect(state.retry(1) == nil)
    }
}
