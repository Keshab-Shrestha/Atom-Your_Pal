import Foundation
import Testing
@testable import ZenoIslandCore

@Suite("Skills hub (B3.5)")
struct HubSkillsTests {
    static let hub = #""skillHub":{"results":[{"name":"pdf-tools","description":"Read PDFs","repo":"a/b","path":"skills/pdf","sha":"0123456789abcdef","source":0},{"name":"bad"}],"pending":[{"id":3,"kind":"update","name":"pdf-tools","description":"d","repo":"a/b","path":"skills/pdf","sha":"fedcba9876","text":"line 1\nline 2","flags":[{"kind":"url","severity":"info","excerpt":"https://x"},{"kind":"shell","severity":"warn","excerpt":"curl | sh"},{"severity":"warn"}]},{"id":4,"kind":"weird","name":"x","text":"t"},{"kind":"new","name":"y","text":"t"}],"installed":[{"name":"pdf-tools","repo":"a/b","path":"skills/pdf","sha":"0123456789abcdef"},{"repo":"no name"}],"message":"2 found"},"#

    func state(_ hub: String) throws -> HelpersState {
        var state = HelpersState()
        state.apply(try decodeEvent(HelperTaskTests.line.replacingOccurrences(of: #"{"type":"helpers","#, with: #"{"type":"helpers","# + hub)))
        return state
    }

    @Test func decodesTheHubAndDropsMalformedEntries() throws {
        let hub = try #require(try state(Self.hub).list).skillHub
        #expect(hub.results.map(\.name) == ["pdf-tools"] && hub.results[0].shortSha == "0123456" && hub.results[0].source == 0)
        #expect(hub.pending.map(\.id) == [3] && hub.pending[0].isUpdate && hub.pending[0].text == "line 1\nline 2")
        #expect(hub.installed.map(\.name) == ["pdf-tools"])
        #expect(hub.message == "2 found")
    }

    @Test func mapsSeverityAndShowsWarningsFirst() throws {
        let pending = try #require(try state(Self.hub).list).skillHub.pending[0]
        #expect(pending.flags.map(\.severity) == [.info, .warn], "a flag without a kind is dropped")
        #expect(pending.sortedFlags.map(\.kind) == ["shell", "url"])
    }

    @Test func missingKeyIsEmpty() throws {
        #expect(try #require(try state("").list).skillHub == .empty)
    }

    @Test func commandsNeedTheRightThing() throws {
        var s = try state(Self.hub)
        #expect(s.hubSearch("  ") == nil)
        #expect(s.hubSearch(" pdf ") == .skillHubSearch(query: "pdf"))
        #expect(s.answerHub(3, approve: true) == .skillHubApprove(id: 3))
        #expect(s.answerHub(3, approve: false) == .skillHubReject(id: 3))
        #expect(s.answerHub(9, approve: true) == nil)
        #expect(s.hubUninstall("pdf-tools") == .skillHubUninstall(name: "pdf-tools"))
        #expect(s.hubUpdate("nope") == nil)
    }

    @Test func needsYouAndNotice() throws {
        let list = try #require(try state(Self.hub).list)
        let item = try #require(NeedsYouItem.all(in: list).first { $0.kind == .skillHub })
        #expect(item.title == "Install pdf-tools from the skills hub?" && item.skillItemId == 3)
    }

    @Test func encodesTheSixCommands() throws {
        #expect(IslandCommand.skillHubSearch(query: "pdf").line == #"{"query":"pdf","type":"skill.hub.search"}"# + "\n")
        #expect(IslandCommand.skillHubSearch(query: String(repeating: "a", count: 90)).line.contains(String(repeating: "a", count: 60) + #"""#))
        #expect(IslandCommand.skillHubPreview(source: 1, path: "s/p").line == #"{"path":"s/p","source":1,"type":"skill.hub.preview"}"# + "\n")
        #expect(IslandCommand.skillHubApprove(id: 3).line == #"{"id":3,"type":"skill.hub.approve"}"# + "\n")
        #expect(IslandCommand.skillHubReject(id: 3).line == #"{"id":3,"type":"skill.hub.reject"}"# + "\n")
        #expect(IslandCommand.skillHubUninstall(name: "x").line == #"{"name":"x","type":"skill.hub.uninstall"}"# + "\n")
        #expect(IslandCommand.skillHubUninstall(name: "x", force: true).line == #"{"force":true,"name":"x","type":"skill.hub.uninstall"}"# + "\n")
        #expect(IslandCommand.skillHubUpdate(name: "x").line == #"{"name":"x","type":"skill.hub.update"}"# + "\n")
    }
}
