import Foundation
import Testing
@testable import AtomIslandCore

/// upgrades.md C1: search everything. The runtime ranks; this reads the groups and finds Settings pages.
@Suite("Search everything (C1)")
struct SearchEverythingTests {
    static let line = #"""
    {"type":"search.results","query":"mesh",
     "chats":[{"id":"c1","title":"Mesh chat","snippet":"…","at":"2026-10-01T00:00:00.000Z"}],"tasks":[],"reports":[],
     "pages":[{"id":"4","title":"Mesh plan","snippet":"buy the kit"},{"title":"no id"}],
     "facts":[{"id":"11","title":"Mesh Wi-Fi at home","snippet":"Mesh Wi-Fi at home","at":"2026-10-01T00:00:00.000Z"}],
     "skills":[{"id":"mesh-compare","title":"mesh-compare","snippet":"Compare kits"}],
     "routines":[{"id":5,"title":"Mesh deals","snippet":"Sid. Every Monday"}]}
    """#.replacingOccurrences(of: "\n", with: "")

    @Test func decodesTheNewGroupsAndLeavesOutMalformedHits() throws {
        guard case .searchResults(let r) = try decodeEvent(Self.line) else { Issue.record("not results"); return }
        #expect(r.chats.map(\.id) == ["c1"])
        #expect(r.hits(.pages).map(\.id) == ["4"], "a hit with no id is left out")
        #expect(r.hits(.facts).first?.at != nil)
        #expect(r.hits(.skills).first?.title == "mesh-compare")
        #expect(r.hits(.routines).map(\.id) == ["5"], "a number id reads as text")
        #expect(r.hits(.projects).isEmpty && r.hits(.agents).isEmpty && r.hits(.notes).isEmpty)
        #expect(!r.isEmpty)
    }

    @Test func anOlderRuntimeSendsNoGroups() throws {
        guard case .searchResults(let r) = try decodeEvent(#"{"type":"search.results","query":"zzzz","chats":[],"tasks":[],"reports":[]}"#) else { Issue.record("not results"); return }
        #expect(SearchKind.allCases.allSatisfy { r.hits($0).isEmpty })
        #expect(r.isEmpty)
    }

    @Test func aGroupAloneMakesTheResultsNotEmpty() {
        let hit = SearchHit(id: "1", title: "x", snippet: "", at: nil)
        #expect(!SearchResults(query: "zzzz", groups: [.agents: [hit]]).isEmpty)
        #expect(SearchResults(query: "zzzz", groups: [.agents: []]).isEmpty)
    }

    @Test func settingsPagesAreFoundOnThisMac() {
        #expect(SearchResults.settingsPages(matching: "model") == [.model])
        #expect(SearchResults.settingsPages(matching: "SHORT") == [.shortcuts], "case is ignored")
        #expect(SearchResults.settingsPages(matching: "ｓｏｕｎｄｓ") == [.sounds], "full-width letters match")
        #expect(SearchResults.settingsPages(matching: "  ").isEmpty)
        #expect(SearchResults.settingsPages(matching: "zzzz").isEmpty)
        #expect(SearchResults.settingsPages(matching: "design").isEmpty)
        #expect(!SearchResults(query: "appearance").isEmpty, "a settings page is a result")
    }

    @Test func searchWirePreservesTheWholeQuery() throws {
        let query = String(repeating: "Cedar日本語", count: 100)
        let data = Data(IslandCommand.search(query: query).line.utf8)
        let fields = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
        #expect(fields["query"] == query)
    }

    @Test func everyGroupHasAHeading() {
        #expect(SearchKind.allCases.map(\.title) == ["Second brain", "Remembered", "Conversation notes", "Projects", "Agents", "Skills", "Routines"])
    }
}
