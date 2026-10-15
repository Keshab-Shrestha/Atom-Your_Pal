import Foundation
import Testing
@testable import AtomIslandCore

/// ADR-113: files and skills in the composer.
@Suite("Composer draft (ADR-113)")
struct ComposerDraftTests {
    @Test func addsFilesOnceAndOnlyFullPaths() {
        var d = ComposerDraft()
        d.add(["/Users/k/a.pdf", "/Users/k/a.pdf", "relative.txt"])
        #expect(d.files.map(\.path) == ["/Users/k/a.pdf"])
        #expect(d.files[0].name == "a.pdf")
    }

    @Test func stopsAtFiveWithANotice() {
        var d = ComposerDraft()
        d.add((1...7).map { "/f\($0).txt" })
        #expect(d.files.count == 5)
        #expect(d.notice == "A message takes 5 files at most.")
        d.remove("/f1.txt")
        #expect(d.files.count == 4 && d.notice == nil)
        d.clear()
        #expect(d.files.isEmpty)
    }

    @Test func buildsThePlainOrTheFileCommand() {
        var d = ComposerDraft()
        #expect(d.command(text: "  ") == nil)
        #expect(d.command(text: " hi ") == .textSend("hi"))
        d.add(["/a.txt"])
        #expect(d.command(text: "") == .textSendFiles(text: "", files: ["/a.txt"]), "files alone can be sent")
        #expect(d.command(text: "read it") == .textSendFiles(text: "read it", files: ["/a.txt"]))
        #expect(d.command(text: String(repeating: "a", count: 4001)) == nil)
    }

    @Test func encodesTheFilesOnTheWire() throws {
        let line = IslandCommand.textSendFiles(text: "x", files: ["/a b.txt"]).line
        let fields = try #require(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        #expect(fields["type"] as? String == "text.send")
        #expect(fields["files"] as? [String] == ["/a b.txt"])
        #expect(fields["text"] as? String == "x")
    }

    @Test func aSkillGoesInFrontOfTheWords() {
        #expect(ComposerDraft.applying(skill: "summarise", to: "this page") == "/summarise this page")
        #expect(ComposerDraft.applying(skill: "summarise", to: "/other this page") == "/summarise this page")
        #expect(ComposerDraft.applying(skill: "summarise", to: "") == "/summarise ")
    }

    /// 2026-10-16 (code review): a message over 4,000 characters was dropped by `ask` and the composer cleared the draft anyway.
    @Test func aTooLongMessageIsRefusedWithAReasonAndTheDraftIsKept() {
        let long = String(repeating: "a", count: 4001)
        let why = ComposerDraft.refusal(forText: long)
        #expect(why?.contains("4001") == true && why?.contains("4000") == true)
        #expect(ComposerDraft.refusal(forText: String(repeating: "a", count: 4000)) == nil)
        #expect(ComposerDraft.refusal(forText: "  short  ") == nil)
        var d = ComposerDraft()
        d.refuse(why!)
        #expect(d.notice == why)
        #expect(d.command(text: long) == nil, "it is still not sendable")
        d.clear()
        #expect(d.notice == nil)
    }
}

