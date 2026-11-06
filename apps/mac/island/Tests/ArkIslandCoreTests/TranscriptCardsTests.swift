import Foundation
import Testing
@testable import ArkIslandCore

/// ADR-275: the worked row, the diff card and the questions card (design reference: Ghostex, MIT).
@Suite("Transcript cards")
struct TranscriptCardsTests {
    private func work(_ state: String, calls: Int = 0, omitted: Int = 0, questions: Int = 0) throws -> ChatWorkSnapshot {
        let call = { #"{"id":"\#(UUID().uuidString)","tool":"Read","state":"ok","ms":10}"# }
        let question = { #"{"id":"\#(UUID().uuidString)","prompt":"Which?","choices":[],"state":"answered","answer":"A"}"# }
        let json = #"{"chat":"c","turn":"\#(UUID().uuidString)","startedAt":"","elapsedMs":9000,"state":"\#(state)","omitted":\#(omitted),"#
            + #""calls":[\#((0..<calls).map { _ in call() }.joined(separator: ","))],"questions":[\#((0..<questions).map { _ in question() }.joined(separator: ","))]}"#
        return try JSONDecoder().decode(ChatWorkSnapshot.self, from: Data(json.utf8))
    }

    @Test("the worked row says how the turn ended and counts only what ARK knows")
    func workedRow() throws {
        let done = try work("completed", calls: 3)
        #expect(ChatWorkText.headline(done, elapsedMs: 9000) == "Worked for 9s")
        #expect(ChatWorkText.chips(done) == ["3 tool calls"])
        let thought = try work("completed")
        #expect(ChatWorkText.headline(thought, elapsedMs: 4000) == "Thought for 4s" && ChatWorkText.chips(thought).isEmpty)
        #expect(ChatWorkText.headline(try work("working", calls: 1), elapsedMs: 2000) == "Working for 2s")
        #expect(ChatWorkText.headline(try work("failed"), elapsedMs: 1000) == "Failed after 1s")
        #expect(ChatWorkText.chips(try work("completed", calls: 1, omitted: 2, questions: 1)) == ["3 tool calls", "1 question"])
        #expect(ChatWorkText.chips(try work("completed", calls: 1)) == ["1 tool call"])
    }

    @Test("a change becomes hunks with two line-number gutters and +/− counts")
    func unifiedDiff() {
        let old = (1...10).map { "line \($0)" }.joined(separator: "\n") + "\n"
        let new = old.replacingOccurrences(of: "line 5\n", with: "line five\nline 5b\n")
        let diff = UnifiedDiff.make(old: old, new: new)
        #expect(diff.added == 2 && diff.removed == 1)
        #expect(diff.hunks.count == 1)
        let hunk = diff.hunks[0]
        #expect(hunk.header == "@@ -2,7 +2,8 @@")
        #expect(hunk.lines.map(\.kind) == [.context, .context, .context, .removed, .added, .added, .context, .context, .context])
        #expect(hunk.lines[0].old == 2 && hunk.lines[0].new == 2)
        #expect(hunk.lines[3].old == 5 && hunk.lines[3].new == nil && hunk.lines[3].text == "line 5")
        #expect(hunk.lines[5].old == nil && hunk.lines[5].new == 6 && hunk.lines[5].text == "line 5b")
        #expect(hunk.lines[6].old == 6 && hunk.lines[6].new == 7)
    }

    @Test("changes far apart are two hunks; near ones share one; a new file starts at 0")
    func hunkGrouping() {
        let old = (1...30).map { "l\($0)" }.joined(separator: "\n")
        let far = old.replacingOccurrences(of: "l2\n", with: "x\n").replacingOccurrences(of: "l28\n", with: "y\n")
        #expect(UnifiedDiff.make(old: old, new: far).hunks.count == 2)
        let near = old.replacingOccurrences(of: "l2\n", with: "x\n").replacingOccurrences(of: "l7\n", with: "y\n")
        #expect(UnifiedDiff.make(old: old, new: near).hunks.count == 1)
        let created = UnifiedDiff.make(old: "", new: "a\nb\n")
        #expect(created.hunks.first?.header == "@@ -0,0 +1,2 @@" && created.added == 2 && created.removed == 0)
        #expect(UnifiedDiff.make(old: "same\n", new: "same\n").hunks.isEmpty)
    }

    @Test("the mini squares follow the counts; the path splits into name and folder")
    func squaresAndPath() {
        #expect(UnifiedDiff.squares(added: 2, removed: 0) == (2, 0))
        #expect(UnifiedDiff.squares(added: 40, removed: 10) == (4, 1))
        #expect(UnifiedDiff.squares(added: 1, removed: 99) == (1, 4), "a side with changes keeps one square")
        #expect(UnifiedDiff.squares(added: 99, removed: 1) == (4, 1))
        #expect(UnifiedDiff.squares(added: 0, removed: 0) == (0, 0))
        #expect(UnifiedDiff.split(path: "/tmp/cedar/launch.md") == ("launch.md", "/tmp/cedar"))
        #expect(UnifiedDiff.split(path: "/launch.md") == ("launch.md", "/"))
        #expect(UnifiedDiff.split(path: "launch.md") == ("launch.md", ""))
    }

    @Test("choice lines become options with a sub-line, a Recommended mark and letter keys")
    func options() {
        let options = ChatQuestions.options(["Postgres | Fits the current stack (recommended)", "SQLite", "  | only a reason"])
        #expect(options.map(\.label) == ["Postgres", "SQLite", "| only a reason"])
        #expect(options[0].detail == "Fits the current stack" && options[0].recommended)
        #expect(options[1].detail == nil && !options[1].recommended)
        #expect(options.map(\.key) == ["a", "b", "c"])
        #expect(ChatQuestions.otherKey(options) == "d")
        #expect(ChatQuestions.options(["Keep it (Recommended)"])[0] == QuestionOption(label: "Keep it", detail: nil, recommended: true, key: "a"))
    }

    @Test("letter and arrow keys pick rows; the answer text follows the pick and the note")
    func picksAndAnswers() {
        let options = ChatQuestions.options(["Yes", "No"])
        #expect(ChatQuestions.pick(key: "a", in: options) == 0)
        #expect(ChatQuestions.pick(key: "B", in: options) == 1)
        #expect(ChatQuestions.pick(key: "c", in: options) == 2, "c is Other")
        #expect(ChatQuestions.pick(key: "d", in: options) == nil)
        #expect(ChatQuestions.pick(key: "a", in: []) == nil, "no options: letters type into the note")
        #expect(ChatQuestions.move(nil, by: 1, options: options) == 0)
        #expect(ChatQuestions.move(nil, by: -1, options: options) == 2)
        #expect(ChatQuestions.move(2, by: 1, options: options) == 2 && ChatQuestions.move(0, by: -1, options: options) == 0)
        #expect(ChatQuestions.answer(options: options, pick: 0, note: " ") == "Yes")
        #expect(ChatQuestions.answer(options: options, pick: 1, note: "after Friday") == "No. after Friday")
        #expect(ChatQuestions.answer(options: options, pick: 2, note: "") == "None of these")
        #expect(ChatQuestions.answer(options: options, pick: 2, note: "Maybe later") == "Maybe later")
        #expect(ChatQuestions.answer(options: options, pick: nil, note: "") == nil, "blank is sent as unanswered")
        #expect(ChatQuestions.answer(options: [], pick: nil, note: "Thursday") == "Thursday")
        #expect(ChatQuestions.count(2) == "2 questions")
    }
}
