import Foundation
import Testing
@testable import ZenoIslandCore

/// Avatars (ADR-085): which image each moment shows, the files' names, the fallbacks, and the
/// Avatar style becoming the default once Pal's images exist.
@Suite("Avatars")
struct AvatarTests {
    @Test func fallbacksEndAtNeutral() {
        #expect(AvatarExpression.neutral.fallbacks == [.neutral])
        for expression in AvatarExpression.allCases where expression != .neutral {
            #expect(expression.fallbacks.first == expression)
            #expect(expression.fallbacks.last == .neutral)
        }
    }

    @Test func helperFollowsItsJobs() {
        func helper(_ states: [JobState]) -> Helper {
            Helper(id: "sid", name: "Sid", available: true, app: nil,
                   jobs: states.enumerated().map { HelperJob(id: $0.offset, task: "t", state: $0.element) })
        }
        #expect(AvatarExpression.helper(helper([])) == .neutral)
        #expect(AvatarExpression.helper(helper([.queued, .running, .done])) == .working) // a newer queued job: still working
        #expect(AvatarExpression.helper(helper([.done, .failed])) == .happy)
        #expect(AvatarExpression.helper(helper([.failed, .done])) == .worried)
        #expect(AvatarExpression.helper(helper([.stopped])) == .neutral)
        #expect(AvatarExpression.helper(helper([.queued])) == .neutral)
    }

    @Test func pathsStayInsideTheFolder() {
        #expect(AvatarExpression.working.path(character: "sid") == "sid/working.png")
        for bad in ["", "../pal", "a/b", "Sid", ".", String(repeating: "a", count: 33)] {
            #expect(AvatarExpression.neutral.path(character: bad) == nil)
        }
    }
}
