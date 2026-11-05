import Foundation
import Testing
@testable import ArkIslandCore

@Suite("ARK notices")
struct ImprovementsTests {
    @Test("the event reads the switch, the run state and each note; a malformed note is left out")
    func readsEvent() {
        let line = #"{"type":"improvements","enabled":true,"running":false,"lastRunAt":"2026-11-05T10:00:00.000Z","notes":[{"id":"crash:137","title":"ARK's runtime stopped by itself","evidence":"8 times in a week.","severity":3,"why":"It loses work.","change":"Find why."},{"id":"x"}]}"#
        guard case .improvements(let state)? = try? decodeEvent(line) else { Issue.record("not an improvements event"); return }
        #expect(state.enabled && !state.running)
        #expect(state.lastRunAt != nil)
        #expect(state.notes == [ImprovementNote(id: "crash:137", title: "ARK's runtime stopped by itself", evidence: "8 times in a week.", severity: 3, why: "It loses work.", change: "Find why.")])
    }

    @Test("Home shows the worst three first")
    func worstThree() {
        let notes = (1...5).map { ImprovementNote(id: "n\($0)", title: "t", evidence: "e", severity: $0 % 3 + 1, why: "", change: "") }
        let shown = ImprovementsState(notes: notes).shown
        #expect(shown.count == 3)
        #expect(shown.first?.severity == 3)
        #expect(shown.map(\.severity) == shown.map(\.severity).sorted(by: >))
    }

    @Test("the chat prompt carries the title, evidence, reason and change, and asks before changing anything")
    func prompt() {
        let text = ImprovementNote(id: "a", title: "Tool fails", evidence: "4 of 12 calls failed.", severity: 2, why: "Users wait.", change: "Retry once.").chatPrompt
        for part in ["Tool fails", "4 of 12 calls failed.", "Users wait.", "Retry once.", "Ask me before changing anything."] { #expect(text.contains(part)) }
    }

    @Test("commands: get, run, switch and dismiss")
    func commands() {
        #expect(IslandCommand.improvementsGet.line == #"{"type":"improvements.get"}"# + "\n")
        #expect(IslandCommand.improvementsRun.line == #"{"type":"improvements.run"}"# + "\n")
        #expect(IslandCommand.improvementsSet(enabled: false).line.contains(#""enabled":false"#))
        #expect(IslandCommand.improvementDismiss(id: "crash:137").line.contains(#""id":"crash:137""#))
    }

    @Test("the fix prompt carries the note, works on its own branch, runs the tests and names what is off limits")
    func fixPrompt() {
        let text = FixPrompt.text(for: ImprovementNote(id: "a", title: "Tool fails", evidence: "4 of 12 calls failed.", severity: 2, why: "Users wait.", change: "Retry once."))
        for part in ["Tool fails", "4 of 12 calls failed.", "Users wait.", "Retry once.", "its own branch", "pnpm typecheck", "Do not push or merge", "security, permission, approval"] { #expect(text.contains(part)) }
    }

    @Test("the event reads fix state, came-back and the notes that stopped; Home shows the latest three")
    func readsResolved() {
        let line = #"{"type":"improvements","enabled":true,"running":false,"notes":[{"id":"a","title":"A","evidence":"e","severity":2,"why":"w","change":"c","fixing":true,"cameBack":true}],"resolved":[{"id":"r1","title":"Tool fails","how":"fixed"},{"id":"r2","title":"Slow","how":"went-away"},{"id":"r3","title":"Three","how":"fixed"},{"id":"r4","title":"Four","how":"fixed"},{"bad":1}]}"#
        guard case .improvements(let state)? = try? decodeEvent(line) else { Issue.record("not an improvements event"); return }
        #expect(state.notes[0].fixing && state.notes[0].cameBack)
        #expect(state.resolved.count == 4)
        #expect(state.recentlyResolved.map(\.id) == ["r1", "r2", "r3"])
        #expect(state.resolved[0].line == "Fixed: Tool fails")
        #expect(state.resolved[1].line == "Went away: Slow")
        #expect(IslandCommand.improvementFixing(id: "a").line.contains(#""type":"improvement.fixing""#))
    }
}
