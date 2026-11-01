import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Chat work text")
struct ChatWorkTextTests {
    private func call(_ tool: String) -> ChatWorkSnapshot.Call {
        ChatWorkSnapshot.Call(id: UUID().uuidString, tool: tool, state: "ok", ms: 10)
    }

    @Test("a call reads as what it does while running and what it did once done")
    func labels() {
        #expect(ChatWorkText.label(tool: "Read", running: true) == "Reading a file")
        #expect(ChatWorkText.label(tool: "Bash", running: false) == "Ran a command")
        #expect(ChatWorkText.label(tool: "mcp__atom__plan_work", running: false) == "Used plan work")
        #expect(ChatWorkText.label(tool: "Mystery", running: true) == "Using Mystery")
    }

    @Test("a finished turn sums its two most frequent kinds, then the others")
    func summary() {
        #expect(ChatWorkText.summary([]) == "")
        #expect(ChatWorkText.summary([call("Read")]) == "Read a file")
        let calls = ["Bash", "Read", "Read", "Grep", "Read", "Bash", "WebSearch"].map(call)
        #expect(ChatWorkText.summary(calls) == "Read 3 files, ran 2 commands, 2 more")
        #expect(ChatWorkText.summary(["Edit", "Write"].map(call)) == "Edited 2 files", "Edit and Write are one kind")
    }
}
