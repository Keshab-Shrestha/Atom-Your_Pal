import Foundation
import Testing
@testable import AtomIslandCore

/// 2026-10-15 (ADR-117): "/" in the message box lists ATOM's commands, Keshab's skills and his Claude commands.
@Suite("Slash menu")
struct SlashMenuTests {
    let skills = [SkillInfo(name: "pdf", description: "Read and write PDFs."), SkillInfo(name: "review", description: "A skill that reviews.")]
    let commands = [
        SlashCommandInfo(name: "build-fix", description: "Fix build errors with minimal changes."),
        SlashCommandInfo(name: "review", description: "Review a file.", hint: "[file]"),
        SlashCommandInfo(name: "new", description: "A command called new."),
        SlashCommandInfo(name: "checkpoint", description: "Create or verify a checkpoint."),
    ]

    @Test func itOpensOnASlashAndNarrowsWithLetters() {
        #expect(SlashMenu.isPicking("/") && SlashMenu.isPicking("/bui"))
        #expect(!SlashMenu.isPicking("") && !SlashMenu.isPicking("hello") && !SlashMenu.isPicking("/review a.ts") && !SlashMenu.isPicking("a /b"))
        #expect(SlashMenu.items(for: "hello", skills: skills, commands: commands).isEmpty)
        let all = SlashMenu.items(for: "/", skills: skills, commands: commands)
        #expect(all.map(\.name).prefix(5) == ["help", "memory", "model", "new", "skills"], "ATOM's own commands lead, by name")
        #expect(SlashMenu.items(for: "/bui", skills: skills, commands: commands).map(\.name) == ["build-fix"])
    }

    @Test func aNameMatchBeatsADescriptionMatch() {
        // "check" starts "checkpoint" (rank 0); it is not in any other name; "errors" is only in a description (rank 2).
        #expect(SlashMenu.items(for: "/check", skills: skills, commands: commands).map(\.name) == ["checkpoint"])
        #expect(SlashMenu.items(for: "/errors", skills: skills, commands: commands).map(\.name) == ["build-fix"])
        // "view" is inside "review" (a name match, rank 1); the description of /new does not mention it.
        #expect(SlashMenu.items(for: "/view", skills: skills, commands: commands).map(\.name) == ["review"])
        #expect(SlashMenu.items(for: "/zzz", skills: skills, commands: commands).isEmpty)
    }

    @Test func eachNameIsListedOnceAndTheRightSourceOwnsIt() {
        let all = SlashMenu.all(skills: skills, commands: commands)
        #expect(Set(all.map(\.name)).count == all.count, "no name twice")
        #expect(all.first { $0.name == "new" }?.source == .atom, "ATOM's /new wins over a command of the same name")
        #expect(all.first { $0.name == "review" }?.source == .skill, "a skill wins over a command of the same name")
        #expect(all.first { $0.name == "build-fix" }?.source == .command)
        #expect(all.first { $0.name == "pdf" }?.sourceLabel == "Skill" && all.first { $0.name == "help" }?.sourceLabel == "ATOM")
    }

    @Test func pickingASkillOrCommandFillsItsNameAndASpace() {
        let item = SlashMenu.items(for: "/build", skills: skills, commands: commands)[0]
        #expect(SlashMenu.completion(for: item) == "/build-fix ")
        #expect(item.title == "/build-fix")
        #expect(SlashMenu.all(skills: [], commands: commands).first { $0.name == "review" }?.hint == "[file]")
    }

    @Test func aFullAtomCommandIsRecognisedWithItsWords() {
        #expect(SlashMenu.builtIn(in: "/new")?.action == .newChat)
        #expect(SlashMenu.builtIn(in: "  /Memory  ")?.action == .memory)
        #expect(SlashMenu.builtIn(in: "/model gpt")?.rest == "gpt")
        #expect(SlashMenu.builtIn(in: "/review a.ts") == nil, "not an ATOM command: it goes to the model")
        #expect(SlashMenu.builtIn(in: "new") == nil && SlashMenu.builtIn(in: "") == nil && SlashMenu.builtIn(in: "/") == nil)
        #expect(Set(SlashMenu.builtIns.compactMap(\.action)).count == SlashMenu.builtIns.count, "each ATOM command has its own action")
    }

    @Test func theRuntimeListDecodesAndCommandsListEncodes() throws {
        let line = #"{"type":"commands","commands":[{"name":"review","description":"Review a file.","hint":"[file]"},{"name":"","description":"no name"},{"name":"plain"}]}"#
        guard case .commands(let list) = try decodeEvent(line) else { Issue.record("not commands"); return }
        #expect(list == [SlashCommandInfo(name: "review", description: "Review a file.", hint: "[file]"), SlashCommandInfo(name: "plain")])
        #expect(try decodeEvent(line).name == "commands")
        #expect(IslandCommand.commandsList.line == #"{"type":"commands.list"}"# + "\n")
    }
}
