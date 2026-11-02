import Foundation
import Testing
@testable import ArkIslandCore

/// The sidebar's live dot (2026-11-02): working beats waiting beats paused beats idle.
@Suite("Agent presence")
struct AgentPresenceTests {
    private func helper(paused: Bool = false, jobs: String = "") throws -> Helper {
        let json = #"{"type":"helpers","apps":[],"helpers":[{"id":"sid","name":"Sid","role":"researcher","available":true,"paused":\#(paused),"jobs":[\#(jobs)]}]}"#
        guard case .helpers(let list) = try decodeEvent(json), let helper = list.helpers.first else { throw CancellationError() }
        return helper
    }
    private let running = #"{"id":1,"task":"a","state":"running","createdAt":"2026-11-02T00:00:00Z"}"#
    private let held = #"{"id":2,"task":"b","state":"queued","createdAt":"2026-11-02T00:00:00Z","held":"Waiting for your plan review"}"#
    private let queued = #"{"id":3,"task":"c","state":"queued","createdAt":"2026-11-02T00:00:00Z"}"#

    @Test func eachStateAndItsOrder() throws {
        #expect(AgentPresence(try helper(jobs: running + "," + held)) == .working)
        #expect(AgentPresence(try helper(jobs: held)) == .waiting)
        #expect(AgentPresence(try helper(paused: true, jobs: queued)) == .paused)
        #expect(AgentPresence(try helper(jobs: queued)) == .idle, "queued without a hold just waits its turn")
        #expect(AgentPresence.waiting.rank < AgentPresence.working.rank && AgentPresence.idle.rank < AgentPresence.paused.rank)
    }
}
