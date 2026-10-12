import Testing
@testable import AtomIslandCore

@Suite("The status line names the model the chat runs on")
struct ChatModelLabelTests {
    @Test func aChatsOwnModelReplacesTheDefaultInTheStatusLine() throws {
        var status = IslandStatus()
        status.apply(.ready(ReadyInfo(protocolVersion: 1, provider: "claude-plan", model: "claude-opus-5-5", microphone: ":default", voice: true)))
        #expect(status.detail == "Claude Opus 5.5")
        status.setChatModel("Claude Haiku 4.5")
        #expect(status.detail == "Claude Haiku 4.5")
        status.apply(try decodeEvent(#"{"type":"state","state":"thinking"}"#))
        #expect(status.detail == "Claude Haiku 4.5")
        status.setChatModel(nil)
        #expect(status.shownModel == "Claude Opus 5.5")
    }
}
