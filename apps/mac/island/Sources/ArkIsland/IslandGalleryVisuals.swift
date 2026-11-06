import Foundation
import SwiftUI
import ArkIslandCore

extension IslandGallery {
    /// ADR-276: a reply with an ```ark-visual card (stats, bars, a line, a table), and a plan card with two notes and the note editor open.
    static func writeArkVisuals(to directory: URL) {
        let reply = """
        The test run finished: two failures, both in the cart.

        ```ark-visual
        {"title":"Test run · cedar-web","blocks":[
          {"type":"stats","items":[{"label":"Passed","value":19,"tone":"good"},{"label":"Failed","value":2,"note":"Both in the cart","tone":"bad"},{"label":"Duration","value":"3.4s"}]},
          {"type":"bar","title":"Slowest tests","unit":"ms","data":[{"label":"checkout","value":1210},{"label":"cart total","value":860},{"label":"login","value":340},{"label":"search","value":210}]},
          {"type":"line","title":"Run time, last 5 runs","unit":"s","data":[{"label":"#41","value":4.1},{"label":"#42","value":3.9},{"label":"#43","value":4.4},{"label":"#44","value":3.6},{"label":"#45","value":3.4}]},
          {"type":"table","title":"Failures","columns":["Test","Error"],"rows":[["cart total","expected 3 items, got 2"],["cart retry","timed out after 5 s"]]}
        ]}
        ```
        """
        let plan = WorkPlanItem(id: 7, goal: "Cedar launch notes", portions: [
            PlanPortion(n: 1, agent: "sid", name: "Sid", task: "Collect the sources", job: 71, state: .done),
            PlanPortion(n: 2, agent: "quill", name: "Quill", task: "Write the notes for the blog and the newsletter", after: [1], state: .running),
            PlanPortion(n: 3, agent: "kame", name: "Kame", task: "Check the links", after: [2], state: .waiting),
        ])
        let notes = [PlanNote(portion: 2, mark: .clarify, text: "Which audience: customers or press?"),
                     PlanNote(portion: 1, mark: .looksGood, text: "")].compactMap { $0 }
        for (suffix, theme) in [("dark", AppTheme.void), ("light", AppTheme.daylight)] {
            let suite = "ark.gallery.visuals.\(suffix).\(ProcessInfo.processInfo.processIdentifier)"
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            model.settings.theme = theme
            model.status.apply(.running(pid: 1))
            if let event = try? decodeEvent(#"{"type":"chats","current":"cedar","chats":[{"id":"cedar","title":"Cedar tests","updatedAt":"2026-10-19T00:00:00Z","messages":2}]}"#) { model.apply(event) }
            if let event = try? decodeEvent(#"{"type":"state","state":"idle"}"#) { model.apply(event); model.status.apply(event) }
            model.conversation.replay([ChatLine(fromUser: true, text: "Run the cedar-web tests and show me the results."), ChatLine(fromUser: false, text: reply)])
            save(HelpersView(model: model).frame(width: 1080, height: 1250).environment(\.islandSnapshot, true), name: "54-ark-visual-" + suffix, to: directory)

            model.setPlanNotes(notes, for: plan)
            let palette = theme.palette
            save(PlanCard(model: model, plan: plan, editing: 3).padding(24).frame(width: 760, height: 600, alignment: .topLeading)
                .background(palette.surfaceSolid.color).themed(palette).environment(\.islandSnapshot, true), name: "54-plan-notes-" + suffix, to: directory)
        }
    }
}
