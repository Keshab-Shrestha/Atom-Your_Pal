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
        #expect(throws: (any Error).self) { try decodeEvent(#"{"type":"chats","chats":[],"current":"cedar","access":"unrestricted"}"#) }
    }
    @Test func commandBindsChatAndPreviousMode() throws {
        let payload = try #require(JSONSerialization.jsonObject(with: Data(IslandCommand.chatAccess(id: "cedar", mode: .chatOnly, expected: .checked).line.utf8)) as? [String: String])
        #expect(payload == ["type": "chat.access", "id": "cedar", "mode": "chat-only", "expected": "checked"])
    }
}

@Suite("Full access consent layout")
struct FullAccessConsentTests {
    @Test func expandedFlagIsExplicitAndOlderCardsStayCompact() throws {
        guard case .approvalRequest(let request) = try decodeEvent(#"{"type":"approval.request","id":"a","summary":"Enable Full access?","reason":"Only this chat. New chats use Saved permissions.","accessChange":true}"#) else { Issue.record("Missing approval"); return }
        #expect(request.accessChange)
        #expect(WorkStripLayout.accessSize.width > WorkStripLayout.askingSize.width)
        #expect(WorkStripLayout.accessSize.height > WorkStripLayout.askingSize.height)
        guard case .approvalRequest(let old) = try decodeEvent(#"{"type":"approval.request","id":"old","summary":"Action","reason":"Because"}"#) else { Issue.record("Missing approval"); return }
        #expect(!old.accessChange)
    }
}
