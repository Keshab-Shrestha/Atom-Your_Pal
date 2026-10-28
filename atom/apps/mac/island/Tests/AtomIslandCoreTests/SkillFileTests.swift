import Foundation
import Testing
@testable import AtomIslandCore

/// 2026-10-15: Plugins → Skills opens a skill's SKILL.md in an editor and saves Keshab's edit.
@Suite("Skill editor")
struct SkillFileTests {
    @Test func encodesTheCommands() throws {
        func fields(_ c: IslandCommand) throws -> [String: Any] {
            try #require(try JSONSerialization.jsonObject(with: Data(c.line.utf8)) as? [String: Any])
        }
        #expect(IslandCommand.skillGet(name: "pdf").line == #"{"name":"pdf","type":"skill.get"}"# + "\n")
        let saved = try fields(.skillSave(name: "pdf", text: "---\nname: pdf\n---\nStep 1.\n"))
        #expect(saved["type"] as? String == "skill.save" && saved["name"] as? String == "pdf")
        #expect(saved["text"] as? String == "---\nname: pdf\n---\nStep 1.\n", "the text keeps its new lines")
    }

    @Test func decodesTheFile() throws {
        let line = #"{"type":"skill.file","name":"pdf","source":"zeno","text":"---\nname: pdf\n---\nStep 1.\n"}"#
        guard case .skillFile(let file) = try decodeEvent(line) else { Issue.record("not a skill file"); return }
        #expect(file == SkillFileData(name: "pdf", source: "zeno", text: "---\nname: pdf\n---\nStep 1.\n"))
        #expect(try decodeEvent(line).name == "skill.file")
        // The source is optional for an older runtime: yours.
        guard case .skillFile(let plain) = try decodeEvent(#"{"type":"skill.file","name":"a","text":"x"}"#) else { Issue.record("not a skill file"); return }
        #expect(plain.source == "yours")
        #expect(throws: (any Error).self) { try decodeEvent(#"{"type":"skill.file","name":"a"}"#) }
    }
}
