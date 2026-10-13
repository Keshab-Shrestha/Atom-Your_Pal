import Testing
@testable import AtomIslandCore

@Suite("Conversation")
struct ConversationTests {
    let timings = TurnTimings(speechMs: 1840, transcriptionMs: 560, modelMs: 1420, firstSoundMs: 910)

    func applying(_ events: [IslandEvent], to conversation: Conversation = Conversation()) -> Conversation {
        var c = conversation
        for event in events { c.apply(event) }
        return c
    }

    @Test func aCompleteTurn() {
        var c = Conversation()
        #expect(c.isEmpty)
        c.apply(.state(.listening))
        c.apply(.transcript("What is the capital of Japan?"))
        #expect(c.turns.count == 1 && c.turns[0].outcome == .inProgress && c.turns[0].reply == nil)
        c.apply(.reply("Tokyo."))
        #expect(c.turns[0].reply == "Tokyo." && c.turns[0].outcome == .inProgress)
        c.apply(.turnComplete(timings))
        c.apply(.state(.idle))
        #expect(c.turns == [Conversation.Turn(id: c.turns[0].id, transcript: "What is the capital of Japan?", reply: "Tokyo.", outcome: .answered, timings: timings)])
        #expect(!c.isEmpty)
    }

    /// ADR-084: the caret glows only while a reply that has arrived is still being spoken; older turns recede.
    @Test func theCaretAndTheLightFollowTheNewestReply() {
        var c = applying([.transcript("First"), .reply("One."), .turnComplete(timings), .state(.idle), .transcript("Second")])
        #expect(!c.turns[1].isStreaming) // no reply yet: the thinking dots, not the caret
        c.apply(.reply("Two."))
        #expect(c.turns[1].isStreaming && !c.turns[0].isStreaming)
        #expect(c.isLatest(c.turns[1]) && !c.isLatest(c.turns[0]))
        c.apply(.turnComplete(timings))
        #expect(!c.turns[1].isStreaming)
    }

    @Test func anErrorFailsTheTurnInProgress() {
        let c = applying([.transcript("Hi"), .error(RuntimeError(stage: "model", message: "Limit reached.")), .state(.idle)])
        #expect(c.turns.map(\.outcome) == [.failed("Limit reached.")])
    }

    @Test func anErrorWithoutATurnAddsNothing() {
        #expect(applying([.error(RuntimeError(stage: "microphone", message: "No mic."))]).isEmpty)
        // An error after the turn finished does not change it.
        let c = applying([.transcript("Hi"), .reply("Hello"), .turnComplete(timings), .error(RuntimeError(stage: "settings", message: "x"))])
        #expect(c.turns.map(\.outcome) == [.answered])
    }

    @Test func noticesFollowATranscriptOnly() {
        #expect(applying([.notice(kind: "too_short", message: "Too short."), .state(.idle)]).isEmpty)
        let c = applying([.transcript("um"), .notice(kind: "no_speech", message: "Nothing heard."), .state(.idle)])
        #expect(c.turns.map(\.outcome) == [.notice("Nothing heard.")])
    }

    @Test func endingWithoutCompletion() {
        // Interrupted while speaking: the reply was shown, so it counts as answered.
        let spoken = applying([.transcript("Tell me a story"), .reply("Once upon a time"), .state(.idle)])
        #expect(spoken.turns.map(\.outcome) == [.answered])
        #expect(spoken.turns[0].timings == nil)
        // Cancelled while thinking: no reply.
        let cancelled = applying([.transcript("Tell me a story"), .state(.thinking), .state(.idle)])
        #expect(cancelled.turns.map(\.outcome) == [.failed("Stopped")])
    }

    @Test func eachTranscriptStartsANewTurn() {
        let c = applying([.transcript("one"), .reply("1"), .turnComplete(timings), .transcript("two"), .reply("2")])
        #expect(c.turns.map(\.transcript) == ["one", "two"])
        #expect(c.turns.map(\.reply) == ["1", "2"])
        #expect(c.turns.map(\.outcome) == [.answered, .inProgress])
    }

    @Test func aReplyWithoutATurnInProgressIsIgnored() {
        let c = applying([.transcript("one"), .turnComplete(timings), .reply("late")])
        #expect(c.turns[0].reply == nil)
    }

    @Test func resetForgetsEverythingButNeverReusesIds() {
        var c = applying([.transcript("one"), .transcript("two")])
        let before = c.turns.map(\.id)
        #expect(before[0] < before[1])
        c.apply(.conversationReset)
        #expect(c.isEmpty)
        c.apply(.transcript("three"))
        #expect(c.turns.count == 1 && c.turns[0].id > before[1])
    }

    @Test func keepsOnlyTheNewestTurns() {
        var c = Conversation(limit: 3)
        for n in 1...5 { c.apply(.transcript("\(n)")) }
        #expect(c.turns.map(\.transcript) == ["3", "4", "5"])
        let ids = c.turns.map(\.id)
        #expect(ids == ids.sorted() && Set(ids).count == 3)
        #expect(Conversation().limit == 50)
    }
}

@Suite("A result posted into the chat (ADR-109)")
struct PostedResultTests {
    @Test func replayKeepsAnAnswerThatHasNoQuestion() {
        var c = Conversation()
        c.replay([ChatLine(fromUser: true, text: "check storage"), ChatLine(fromUser: false, text: "On it."), ChatLine(fromUser: false, text: "Kame finished: storage"), ChatLine(fromUser: true, text: "thanks"), ChatLine(fromUser: false, text: "Welcome.")])
        #expect(c.turns.map(\.transcript) == ["check storage", "", "thanks"])
        #expect(c.turns.map(\.reply) == ["On it.", "Kame finished: storage", "Welcome."])
        #expect(Set(c.turns.map(\.id)).count == 3)
    }
}
