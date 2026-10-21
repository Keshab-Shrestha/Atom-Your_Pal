import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Per-chat access")
struct ChatAccessTests {
    @Test func authoritativeModeAndOldRuntimeCompatibility() throws {
        for mode in ChatAccessMode.allCases {
            guard case .chats(let list) = try decodeEvent("{\"type\":\"chats\",\"chats\":[],\"current\":\"cedar\",\"access\":\"\(mode.rawValue)\"}") else { Issue.record("Missing chats"); return }
            #expect(list.access == mode)
        }
        guard case .chats(let old) = try decodeEvent(#"{"type":"chats","chats":[],"current":"cedar"}"#) else { Issue.record("Missing chats"); return }
        #expect(old.access == nil)
        #expect(throws: (any Error).self) { try decodeEvent(#"{"type":"chats","chats":[],"current":"cedar","access":"full"}"#) }
    }
    @Test func commandBindsChatAndPreviousMode() throws {
        let payload = try #require(JSONSerialization.jsonObject(with: Data(IslandCommand.chatAccess(id: "cedar", mode: .chatOnly, expected: .checked).line.utf8)) as? [String: String])
        #expect(payload == ["type": "chat.access", "id": "cedar", "mode": "chat-only", "expected": "checked"])
    }
}
