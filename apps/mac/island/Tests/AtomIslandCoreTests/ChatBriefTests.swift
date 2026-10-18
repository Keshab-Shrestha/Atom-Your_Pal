import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Chat brief")
struct ChatBriefTests {
    @Test func acceptsUnicodeAtTheByteBoundaryAndRefusesHiddenControls() throws {
        #expect(ChatBrief.valid(String(repeating: "🌲", count: 1000)))
        #expect(!ChatBrief.valid(String(repeating: "🌲", count: 1000) + "x"))
        #expect(ChatBrief.valid("日本語\n\t'quoted'\r\n🌲"))
        for text in ["escape\u{1B}[31m", "left\u{202E}right", "hidden\u{200B}"] { #expect(!ChatBrief.valid(text)) }
    }
    @Test func serializesAnExplicitVersionedSaveAndDecodesItsReceipt() throws {
        let request = ChatControlRequest(action: .brief, id: "cedar", version: 4, text: "Launch Friday")
        #expect(request.fields["text"] as? String == "Launch Friday")
        #expect(request.fields["version"] as? Int == 4)
        let json = #"{"type":"chat.control","action":"brief","id":"cedar","request":"r","ok":true,"brief":{"text":"Launch Friday","version":5}}"#
        guard case .chatControl(let response) = try decodeEvent(json) else { Issue.record("Missing receipt"); return }
        #expect(response.brief == ChatBrief(text: "Launch Friday", version: 5))
        #expect(throws: (any Error).self) {
            try JSONDecoder().decode(ChatBrief.self, from: Data(#"{"text":"x","version":-1}"#.utf8))
        }
    }
}
