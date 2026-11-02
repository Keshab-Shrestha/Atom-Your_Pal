import Testing
@testable import ArkIslandCore

/// The ⌘K palette's search (2026-11-02).
@Suite("Command palette")
struct CommandPaletteTests {
    private let entries = [
        PaletteEntry(id: "new-chat", title: "New chat", symbol: "square.and.pencil", group: "Actions"),
        PaletteEntry(id: "studio", title: "Studio", detail: "Board", symbol: "building", group: "Go to", keywords: "office floor agents"),
        PaletteEntry(id: "chat:kyoto", title: "Plan a weekend in Kyoto", symbol: "bubble", group: "Chats"),
        PaletteEntry(id: "theme:paper", title: "Paper & Teal", detail: "Theme", symbol: "paintpalette", group: "Themes"),
        PaletteEntry(id: "agent:sid", title: "Sid", detail: "Researcher", symbol: "person", group: "Agents"),
    ]

    @Test func everyWordMustMatchAndTitleStartsComeFirst() {
        #expect(PaletteSearch.rank(entries, "").map(\.id) == entries.map(\.id), "empty: the given order")
        #expect(PaletteSearch.rank(entries, "kyoto weekend").map(\.id) == ["chat:kyoto"], "all words, any order")
        #expect(PaletteSearch.rank(entries, "board").map(\.id) == ["studio"], "detail and keywords count")
        #expect(PaletteSearch.rank(entries, "s").first?.id == "studio", "a title that starts with the query first")
        #expect(PaletteSearch.rank(entries, "RESEARCHER").map(\.id) == ["agent:sid"], "any case")
        #expect(PaletteSearch.rank(entries, "paper teal").map(\.id) == ["theme:paper"])
        #expect(PaletteSearch.rank(entries, "nothing like this").isEmpty)
        #expect(PaletteSearch.rank(entries, "", limit: 2).count == 2)
    }
}
