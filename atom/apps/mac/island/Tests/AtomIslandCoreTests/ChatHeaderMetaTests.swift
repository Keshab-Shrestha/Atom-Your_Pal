import Testing
@testable import AtomIslandCore

/// The small line above a chat's title (from the HTML preview's header chips): the project, whether the chat is pinned,
/// and the model it uses.
struct ChatHeaderMetaTests {
    @Test func joinsWhatIsKnownInReadingOrder() {
        #expect(ChatHeaderMeta.line(project: "Haat", pinned: true, model: "Claude Sonnet 5.5") == "Haat · Pinned · Claude Sonnet 5.5")
        #expect(ChatHeaderMeta.line(project: "Haat", pinned: false, model: "Claude Sonnet 5.5") == "Haat · Claude Sonnet 5.5")
    }

    @Test func theContextShareComesLastWhenKnown() {
        #expect(ChatHeaderMeta.line(project: "Haat", pinned: true, model: "Claude Sonnet 5.5", context: "1%") == "Haat · Pinned · Claude Sonnet 5.5 · 1% context")
        #expect(ChatHeaderMeta.line(project: nil, pinned: false, model: nil, context: "<1%") == "<1% context")
        #expect(ChatHeaderMeta.line(project: nil, pinned: false, model: "Claude", context: nil) == "Claude")
    }

    @Test func leavesOutWhatIsMissing() {
        #expect(ChatHeaderMeta.line(project: nil, pinned: false, model: "Claude Haiku 5.5") == "Claude Haiku 5.5")
        #expect(ChatHeaderMeta.line(project: nil, pinned: true, model: nil) == "Pinned")
        #expect(ChatHeaderMeta.line(project: "  ", pinned: false, model: "") == nil, "nothing to say, no line")
        #expect(ChatHeaderMeta.line(project: nil, pinned: false, model: nil) == nil)
    }

    @Test func eachPartStaysOneTrimmedLine() {
        #expect(ChatHeaderMeta.line(project: "  Haat\n shop ", pinned: false, model: nil) == "Haat shop")
    }
}
