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
