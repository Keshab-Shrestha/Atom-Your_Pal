import Testing
@testable import ZenoIslandCore

@Suite("Pal's bubble only when it has words to say")
struct BubbleRuleTests {
    @Test func turnStatesShowNoBubble() throws {
        var status = IslandStatus()
        for state in [#"{"type":"state","state":"listening"}"#, #"{"type":"state","state":"thinking"}"#, #"{"type":"state","state":"speaking"}"#] {
            status.apply(try decodeEvent(state))
            #expect(!status.needsBubble, "\(state)")
        }
    }

    /// ADR-093: "Speak now" shows on Pal itself, not in a bubble (Keshab kept the 2026-10-10 rule).
    @Test func aLiveMicrophoneSaysSpeakNowWithoutABubble() throws {
        var status = IslandStatus()
        status.apply(try decodeEvent(#"{"type":"state","state":"listening"}"#))
        #expect(!status.needsBubble)
        status.apply(try decodeEvent(#"{"type":"mic.ready"}"#))
        #expect(!status.needsBubble && status.title == "Speak now" && status.micLive)
    }

    @Test func problemsNoticesQuestionsAndASilentMicShowIt() throws {
        var status = IslandStatus()
        status.apply(try decodeEvent(#"{"type":"state","state":"listening"}"#))
        status.apply(try decodeEvent(#"{"type":"mic.silent","microphone":"MacBook Microphone"}"#))
        #expect(status.needsBubble)
        status.apply(try decodeEvent(#"{"type":"approval.request","id":"a1","summary":"Click Send","reason":"It sends"}"#))
        #expect(status.needsBubble)
        status.apply(try decodeEvent(#"{"type":"notice","kind":"no_speech","message":"I didn't hear anything"}"#))
        #expect(status.needsBubble)
    }
}
