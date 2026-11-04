import Foundation
import Testing
@testable import ArkIslandCore

// 2026-11-04: ARK keeps noticed facts by itself and shows a "Remembered" row with Undo.
@Suite("Remembered facts")
struct RememberedFactsTests {
    @Test("the list carries the kept facts, and Undo works only for a fact in it")
    func undoNeedsAReceipt() {
        var state = SuggestionsState()
        state.apply(SuggestionsList(enabled: true, kept: [FactSuggestion(id: 7, text: "Prefers window seats.")]))
        #expect(state.kept.map(\.id) == [7])
        #expect(state.undo(7) == .suggestionsUndo(id: 7))
        #expect(state.undo(8) == nil)
        state.apply(SuggestionsList(enabled: true))
        #expect(state.kept.isEmpty)
    }

    @Test("the runtime message reads the kept facts; a malformed one is left out")
    func readsKept() {
        let line = #"{"type":"suggestions","enabled":true,"items":[],"kept":[{"id":3,"text":"Lives in Tokyo."},{"id":"x"}]}"#
        guard case .suggestions(let list)? = try? decodeEvent(line) else { Issue.record("not a suggestions event"); return }
        #expect(list.kept.map(\.text) == ["Lives in Tokyo."])
    }

    @Test("Undo is sent as suggestions.undo with the memory id")
    func commandShape() throws {
        let json = try #require(JSONSerialization.jsonObject(with: Data(IslandCommand.suggestionsUndo(id: 3).line.utf8)) as? [String: Any])
        #expect(json["type"] as? String == "suggestions.undo")
        #expect(json["id"] as? Int == 3)
    }
}

@Suite("Pre-warm command")
struct WarmCommandTests {
    @Test("chat.warm is a bare command, and losing it at a restart is not shown to the user")
    func shape() {
        #expect(IslandCommand.chatWarm.line == #"{"type":"chat.warm"}"# + "\n")
        #expect(DroppedCommand.shouldTell(commandType: "chat.warm") == false)
    }
}

@Suite("Watches")
struct WatchesTests {
    @Test("the watches event reads each watch; a malformed one is left out")
    func readsWatches() {
        let line = #"{"type":"watches","watches":[{"id":"a1b2c3d4","url":"https://example.com/slots","mode":"contains","text":"slots open","everyMinutes":30,"state":"watching","lastCheckAt":"2026-11-04T10:30:00.000Z"},{"id":"x"}]}"#
        guard case .watches(let list)? = try? decodeEvent(line) else { Issue.record("not a watches event"); return }
        #expect(list.count == 1)
        #expect(list[0].host == "example.com")
        #expect(list[0].condition == "until it shows “slots open”")
        #expect(list[0].interval == "every 30 minutes")
        #expect(list[0].lastCheckAt != nil)
    }

    @Test("a fired watch becomes a notice; a stopped one says so")
    func readsNotice() {
        guard case .watchFired(let fired)? = try? decodeEvent(#"{"type":"watchFired","id":"a1","kind":"fired","message":"example.com changed."}"#) else { Issue.record("not a notice"); return }
        #expect(fired == WatchNotice(id: "a1", stopped: false, message: "example.com changed."))
        guard case .watchFired(let stopped)? = try? decodeEvent(#"{"type":"watchFired","id":"a2","kind":"stopped","message":"ARK stopped watching example.com."}"#) else { Issue.record("not a notice"); return }
        #expect(stopped.stopped)
    }

    @Test("commands: watches.get and watch.remove with the id")
    func commands() {
        #expect(IslandCommand.watchesGet.line == #"{"type":"watches.get"}"# + "\n")
        #expect(IslandCommand.watchRemove(id: "a1b2c3d4").line.contains(#""id":"a1b2c3d4""#))
        #expect(WatchItem(id: "w", url: "https://x.test/", mode: "change", everyMinutes: 120, state: "fired").interval == "every 2 hours")
    }
}
