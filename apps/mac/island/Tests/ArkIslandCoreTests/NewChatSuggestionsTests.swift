import Foundation
import Testing
@testable import ArkIslandCore

@Suite("New chat suggestions")
struct NewChatSuggestionsTests {
    @Test func lastChatThenOpenTasksFromThisProject() {
        let t = { (s: Double) in Date(timeIntervalSince1970: s) }
        let chats = [ChatInfo(id: "now", title: "New", updatedAt: t(50), messages: 0),
                     ChatInfo(id: "a", title: "Cedar launch", updatedAt: t(40), messages: 4, projectId: "p"),
                     ChatInfo(id: "b", title: "Other project", updatedAt: t(45), messages: 2, projectId: "q"),
                     ChatInfo(id: "c", title: "Older Cedar", updatedAt: t(10), messages: 2, projectId: "p")]
        let sid = Helper(id: "sid", name: "Sid", available: true, app: nil,
                         jobs: [HelperJob(id: 7, task: "Compare kits", state: .running, createdAt: t(30)), HelperJob(id: 6, task: "Old", state: .done, createdAt: t(5))])
        let items = NewChatSuggestions.items(chats: chats, current: "now", project: "p", helpers: [sid])
        #expect(items.map(\.title) == ["Continue \u{201C}Cedar launch\u{201D}", "Compare kits", "Continue \u{201C}Older Cedar\u{201D}"])
        #expect(items.map(\.action) == [.openChat("a"), .openTask(7), .openChat("c")])
        #expect(items[1].detail == "Sid · working")
        #expect(NewChatSuggestions.items(chats: [], current: nil, project: nil, helpers: []).isEmpty)
    }
}
