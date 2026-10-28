import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Per-chat thinking")
struct ChatReasoningTests {
    @Test func decodesExactSupportedLevelsAndSelection() throws {
        let line = #"{"type":"chats","chats":[],"current":"cedar","reasoning":{"provider":"codex","model":"gpt-test","levels":["low","medium","high","xhigh"],"default":"low","selected":"medium","effective":"medium"}}"#
        guard case .chats(let chats) = try decodeEvent(line) else { Issue.record("Missing chats"); return }
        #expect(chats.reasoning?.title == "Medium")
        #expect(chats.reasoning?.levels == ["low", "medium", "high", "xhigh"])
        #expect(ChatReasoning.title("xhigh") == "Extra high")
        #expect(ChatReasoning.title("off") == "Off")
    }
    @Test func oldRuntimeHasNoPretendSelector() throws {
        guard case .chats(let chats) = try decodeEvent(#"{"type":"chats","chats":[],"current":"cedar"}"#) else { Issue.record("Missing chats"); return }
        #expect(chats.reasoning == nil)
    }
    @Test func commandBindsThinkingToTheCapturedChatAndModel() throws {
        let command = IslandCommand.chatReasoning(id: "cedar", provider: "codex", model: "gpt-test", effort: "medium")
        let payload = try #require(JSONSerialization.jsonObject(with: Data(command.line.utf8)) as? [String: String])
        #expect(payload == ["type": "chat.reasoning", "id": "cedar", "provider": "codex", "model": "gpt-test", "effort": "medium"])
        #expect(IslandCommand.chatReasoning(id: "cedar", provider: "codex", model: "gpt-test", effort: "").line.contains(#""effort":"""#))
    }
}
