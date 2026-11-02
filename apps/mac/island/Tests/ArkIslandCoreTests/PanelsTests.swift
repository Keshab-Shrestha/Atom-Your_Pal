import Foundation
import Testing
@testable import ArkIslandCore

/// Panels in the window (2026-11-02): the runtime's event decodes, templates fill ARK's live numbers, a new panel is sent without an id.
@Suite("Panels")
struct PanelsTests {
    @Test func theEventDecodesEveryBlockKind() throws {
        let json = #"{"type":"panels","panels":[{"id":"p1","name":"Day","enabled":true,"home":true,"createdAt":"2026-11-02T00:00:00.000Z","updatedAt":"2026-11-02T00:00:00.000Z","blocks":[{"kind":"stat","label":"Needs you","value":"{{live.needsYou}}","detail":"now"},{"kind":"progress","label":"Done","value":"3","max":10},{"kind":"checklist","items":[{"text":"Dune","done":true},{"text":"Hyperion","done":false}]},{"kind":"counter","label":"Water","count":3,"step":1},{"kind":"chart","chart":{"type":"bar","labels":["Mon"],"series":[{"name":"Cups","values":[3]}]}},{"kind":"button","label":"Plan","action":{"kind":"ask","prompt":"Plan my day"}}]}],"problem":"x"}"#
        guard case .panels(let list) = try decodeEvent(json) else { Issue.record("not a panels event"); return }
        #expect(list.problem == "x")
        let panel = try #require(list.panels.first)
        #expect(panel.name == "Day" && panel.home && panel.blocks.map(\.kind) == ["stat", "progress", "checklist", "counter", "chart", "button"])
        #expect(panel.blocks[2].items?.map(\.done) == [true, false])
        #expect(panel.blocks[5].action == Panel.Action(kind: "ask", prompt: "Plan my day"))
    }

    @Test func templatesFillLiveNumbers() {
        let live = ["needsYou": 3, "tokensToday": 12_400]
        #expect(PanelTemplate.render("{{live.needsYou}} waiting", live: live) == "3 waiting")
        #expect(PanelTemplate.render("{{ live.tokensToday | short }} tokens", live: live) == "12K tokens", "the Dashboard's short form")
        #expect(PanelTemplate.render("{{live.nothing}} and {{state.x}}", live: live) == "— and —", "an unknown name is a dash, nothing runs")
        #expect(PanelTemplate.render("open {{ never closed", live: live) == "open {{ never closed")
        #expect(PanelTemplate.render("no tokens", live: live) == "no tokens")
        #expect(PanelTemplate.fraction(value: "{{live.needsYou}}", max: 6, live: live) == 0.5)
        #expect(PanelTemplate.fraction(value: "12", max: 6, live: live) == 1, "over the max stops at full")
        #expect(PanelTemplate.fraction(value: "soon", max: 6, live: live) == 0)
    }

    @Test func aNewPanelIsSentWithoutAnId() {
        let object = Panel(name: "New", blocks: [.init(kind: "text", text: "Hi")]).jsonObject
        #expect(object["id"] == nil && object["name"] as? String == "New" && object["enabled"] as? Bool == true)
        #expect((object["blocks"] as? [[String: Any]])?.first?["kind"] as? String == "text")
    }
}
