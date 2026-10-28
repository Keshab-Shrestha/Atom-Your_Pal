import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Native file review approval")
struct FileEditReviewTests {
    let token = "a5122207-a70e-45f9-8060-a9b40d912e98"

    func event(before: String = "Cedar Wednesday", after: String = "Cedar Thursday", token: String? = nil) throws -> IslandEvent {
        let object: [String: Any] = ["type": "approval.request", "id": "review", "summary": "Review Cedar", "reason": "File change",
            "fileReview": ["path": "/fictional/cedar.txt", "before": before, "after": after, "token": token ?? self.token]]
        return try decodeEvent(String(decoding: JSONSerialization.data(withJSONObject: object), as: UTF8.self))
    }

    @Test func completeTextSurvivesDecodeAndOnlyMatchingReviewCanApprove() throws {
        let before = "Cedar Wednesday.\n".repeated(60), after = "Cedar Thursday.\n".repeated(60)
        let decoded = try event(before: before, after: after)
        var state = ApprovalState(); state.apply(decoded)
        #expect(state.pending?.fileReview?.before == before)
        #expect(state.pending?.fileReview?.after == after)
        #expect(state.answer(approved: true) == nil)
        #expect(state.answer(approved: true, reviewToken: UUID().uuidString) == nil)
        #expect(state.pending != nil)
        let answer = state.answer(approved: true, reviewToken: token)
        let command = try #require(answer)
        let fields = try #require(JSONSerialization.jsonObject(with: Data(command.line.utf8)) as? [String: Any])
        #expect(fields["reviewToken"] as? String == token)
        #expect(fields["approved"] as? Bool == true)
        #expect(fields["rememberFile"] == nil)
        #expect(state.pending == nil)
    }

    @Test func lateReviewCannotApproveANewerRequestOrSurviveStop() throws {
        var state = ApprovalState(); state.apply(try event())
        let next = "583c95ae-68bb-419e-b46c-76d309d17d67"
        state.apply(try event(token: next))
        #expect(state.answer(approved: true, reviewToken: token) == nil)
        #expect(state.pending?.fileReview?.token == next)
        state.runtimeStopped()
        #expect(state.answer(approved: true, reviewToken: next) == nil)
    }

    @Test func malformedAndOversizedReviewsRefuseInsteadOfLosingTheirDetails() throws {
        for values in [("x", "y", "not-a-uuid"), ("x", String(repeating: "y", count: 33 * 1024), token), ("x\n".repeated(501), "y\n".repeated(501), token)] {
            #expect(throws: ProtocolError.invalidValue(event: "approval.request", field: "fileReview")) {
                try event(before: values.0, after: values.1, token: values.2)
            }
        }
    }
}

private extension String {
    func repeated(_ count: Int) -> String { String(repeating: self, count: count) }
}
