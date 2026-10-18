import Testing
@testable import AtomIslandCore

/// ADR-127: a message typed while ATOM answers waits and goes when the answer ends.
struct MessageQueueTests {
    private func files(_ paths: String...) -> ComposerDraft {
        var d = ComposerDraft()
        d.add(paths)
        return d
    }

    @Test func aTurnRunsFromTranscribingToIdle() {
        var q = MessageQueue()
        #expect(!q.running)
        for state in [LoopState.transcribing, .thinking, .speaking] {
            _ = q.turn(state)
            #expect(q.running, "\(state)")
        }
        _ = q.turn(.listening)
        #expect(!q.running, "listening is Keshab's turn: typing then goes at once, as before")
        _ = q.turn(.idle)
        #expect(!q.running)
    }

    @Test func theMessageGoesWhenTheAnswerEnds() {
        var q = MessageQueue()
        _ = q.turn(.thinking)
        let message = q.add(text: "and in Osaka?", files: files("/a.txt"), chat: "c1")!
        #expect(q.next?.text == "and in Osaka?")
        #expect(q.turn(.speaking) == .none, "still answering")
        #expect(q.turn(.idle) == .send(message))
        #expect(q.next == nil)
        #expect(q.turn(.idle) == .none, "once")
    }

    @Test func followUpsStaySeparateAndWaitForTheirOwnTurns() {
        var q = MessageQueue()
        _ = q.turn(.thinking)
        let first = q.add(text: "first", files: files("/a"), chat: "c1")!
        let second = q.add(text: "second", files: files("/b", "/a"), chat: "c1")!
        let third = q.add(text: "", files: files("/c"), chat: "c1")!
        #expect(q.messages.map(\.text) == ["first", "second", ""])
        #expect(first.id != second.id)
        #expect(second.files.files.map(\.path) == ["/b", "/a"])
        #expect(q.turn(.idle, chat: "c1") == .send(first))
        #expect(q.turn(.idle, chat: "c1") == .none, "a duplicate idle must not interrupt the submitted message")
        #expect(q.messages == [second, third])
        _ = q.turn(.thinking)
        #expect(q.turn(.idle, chat: "c1") == .send(second))
        #expect(q.messages == [third])
    }

    @Test func stoppedOrFailedItComesBackToTheBox() {
        var q = MessageQueue()
        _ = q.turn(.thinking)
        let stopped = q.add(text: "next", files: ComposerDraft(), chat: "c1")!
        q.stopped()
        #expect(q.turn(.idle) == .backToBox([stopped]))
        _ = q.turn(.thinking)
        let failed = q.add(text: "again", files: ComposerDraft(), chat: "c1")!
        q.failed()
        #expect(q.turn(.idle) == .backToBox([failed]))
        _ = q.turn(.thinking)
        let fine = q.add(text: "fine", files: ComposerDraft(), chat: "c1")!
        #expect(q.turn(.idle) == .send(fine), "a stop is forgotten when its turn ends")
    }

    @Test func leavingTheChatPutsItBackInThatChatsBox() {
        var q = MessageQueue()
        _ = q.turn(.thinking)
        let next = q.add(text: "next", files: ComposerDraft(), chat: "c1")!
        let later = q.add(text: "later", files: ComposerDraft(), chat: "c1")!
        #expect(q.sending(.chatOpen(id: "c2")) == [next, later])
        #expect(q.next == nil)
        #expect(q.turn(.idle) == .none, "the cancelled answer's idle sends nothing into the other chat")
        q.add(text: "x", files: ComposerDraft(), chat: "c1")
        #expect(q.sending(.textSend("other")).isEmpty, "other commands leave it waiting")
        #expect(!q.sending(.conversationReset).isEmpty)
        q.add(text: "x", files: ComposerDraft(), chat: "c1")
        #expect(!q.sending(.chatNew(projectId: "p")).isEmpty)
    }

    @Test func aDifferentChatAtTheEndIsNotSentTo() {
        var q = MessageQueue()
        _ = q.turn(.thinking)
        let next = q.add(text: "next", files: ComposerDraft(), chat: "c1")!
        #expect(q.turn(.idle, chat: "c2") == .backToBox([next]))
        _ = q.turn(.thinking)
        let fresh = q.add(text: "new chat", files: ComposerDraft(), chat: "")!
        #expect(q.turn(.idle, chat: "s9") == .send(fresh),
                "a new chat gets its id with its first answer: still the same chat (ADR-125)")
    }

    @Test func takeEmptiesIt() {
        var q = MessageQueue()
        _ = q.turn(.thinking)
        q.add(text: "edit me", files: ComposerDraft(), chat: "c1")
        #expect(q.take()?.text == "edit me")
        #expect(q.next == nil)
        #expect(q.turn(.idle) == .none)
    }
}
