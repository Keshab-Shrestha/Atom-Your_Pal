import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Chat work text")
struct ChatWorkTextTests {
    private func call(_ tool: String) -> ChatWorkSnapshot.Call {
        ChatWorkSnapshot.Call(id: UUID().uuidString, tool: tool, state: "ok", ms: 10)
    }

    @Test("a call reads as what it does while running and what it did once done")
    func labels() {
        #expect(ChatWorkText.label(tool: "Read", running: true) == "Reading a file")
        #expect(ChatWorkText.label(tool: "Bash", running: false) == "Ran a command")
        #expect(ChatWorkText.label(tool: "mcp__ark__plan_work", running: false) == "Used plan work")
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

    @Test("tool tiles, the thinking pill's words and short durations (after affectUI, MIT)")
    func pillAndTiles() throws {
        #expect(ChatWorkText.symbol(tool: "Bash") == "terminal" && ChatWorkText.symbol(tool: "mcp__x__y") == "wrench.and.screwdriver")
        #expect(ChatWorkText.phase(nil) == "Thinking")
        let json = #"{"chat":"c","turn":"\#(UUID().uuidString)","startedAt":"","elapsedMs":0,"state":"working","omitted":0,"questions":[],"calls":[{"id":"\#(UUID().uuidString)","tool":"Read","state":"ok","ms":5},{"id":"\#(UUID().uuidString)","tool":"WebSearch","state":"started"}]}"#
        let work = try JSONDecoder().decode(ChatWorkSnapshot.self, from: Data(json.utf8))
        #expect(ChatWorkText.phase(work) == "Searching the web", "the running call, not a timer")
        var finished = work
        finished.calls[1].state = "ok"
        #expect(ChatWorkText.phase(finished) == "Thinking")
        #expect(ChatWorkText.duration(ms: 4_200) == "4s" && ChatWorkText.duration(ms: 75_000) == "1m 15s" && ChatWorkText.duration(ms: 7_500_000) == "2h 05m" && ChatWorkText.duration(ms: 834_780_000) == "9d 15h")
    }
}
