import Foundation
import Testing
@testable import ArkIslandCore

@Suite("AI programs on this Mac (ADR-269)")
struct AiProgramsTests {
    @Test("the event reads each program and the scan time; a malformed entry is left out")
    func readsEvent() {
        let line = #"{"type":"ai.programs","scannedAt":"2026-11-06T03:00:00.000Z","programs":[{"id":"codex","name":"Codex","found":true,"version":"0.98.0","path":"~/.local/bin/codex","status":"ready","signedIn":true,"provider":"codex","allowed":false,"note":"ARK can chat with it"},{"id":"aider","name":"Aider","found":false,"status":"found","allowed":false},{"id":"broken"}]}"#
        guard case .aiPrograms(let state)? = try? decodeEvent(line) else { Issue.record("not an ai.programs event"); return }
        #expect(state.scannedAt != nil)
        #expect(state.programs == [
            AiProgram(id: "codex", name: "Codex", found: true, version: "0.98.0", path: "~/.local/bin/codex", status: "ready", signedIn: true, provider: "codex", allowed: false, note: "ARK can chat with it"),
            AiProgram(id: "aider", name: "Aider", found: false, status: "found"),
        ])
    }

    @Test("rescan and the may-use switch encode as the runtime expects, with a real JSON boolean")
    func encodesCommands() throws {
        #expect(IslandCommand.aiProgramsScan.line == #"{"type":"ai.programs.scan"}"# + "\n")
        let object = try JSONSerialization.jsonObject(with: Data(IslandCommand.aiProgramsAllow(id: "codex", allowed: false).line.utf8)) as? [String: Any]
        #expect(object?.count == 3)
        #expect(object?["type"] as? String == "ai.programs.allow")
        #expect(object?["id"] as? String == "codex")
        let allowed = object?["allowed"] as? NSNumber
        #expect(allowed.map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true)
        #expect(allowed?.boolValue == false)
    }
}
