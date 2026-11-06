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
        let two = UnifiedDiff.make(old: old, new: far).hunks
        #expect(two.count == 2)
        #expect(two[0].header == "@@ -1,5 +1,5 @@")
        #expect(two[1].header == "@@ -25,6 +25,6 @@")
        #expect(two[1].lines.map(\.kind) == [.context, .context, .context, .removed, .added, .context, .context, .note])
        #expect(two[1].lines[0].old == 25 && two[1].lines[0].new == 25 && two[1].lines[0].text == "l25")
        #expect(two[1].lines[3].old == 28 && two[1].lines[3].text == "l28" && two[1].lines[4].new == 28 && two[1].lines[4].text == "y")
        #expect(two[1].lines[6].old == 30 && two[1].lines[6].new == 30, "the file has no final newline, so a note follows l30")
        let near = old.replacingOccurrences(of: "l2\n", with: "x\n").replacingOccurrences(of: "l7\n", with: "y\n")
        #expect(UnifiedDiff.make(old: old, new: near).hunks.count == 1)
        let created = UnifiedDiff.make(old: "", new: "a\nb\n")
        #expect(created.hunks.first?.header == "@@ -0,0 +1,2 @@" && created.added == 2 && created.removed == 0)
        #expect(UnifiedDiff.make(old: "same\n", new: "same\n").hunks.isEmpty)
    }

    @Test("a change to only the final newline shows the line as changed, with a no-newline note")
    func finalNewline() {
        let dropped = UnifiedDiff.make(old: "a\nb\n", new: "a\nb")
        #expect(dropped.added == 1 && dropped.removed == 1)
        #expect(dropped.hunks.first?.header == "@@ -1,2 +1,2 @@")
        #expect(dropped.hunks.first?.lines.map(\.kind) == [.context, .removed, .added, .note])
        #expect(dropped.hunks.first?.lines.last?.text == UnifiedDiff.noNewline)
        let added = UnifiedDiff.make(old: "a\nb", new: "a\nb\n")
        #expect(added.hunks.first?.lines.map(\.kind) == [.context, .removed, .note, .added])
        #expect(UnifiedDiff.make(old: "a\nb", new: "a\nb").hunks.isEmpty)
    }

    @Test("a removed line and its added pair mark only the changed characters")
    func changedRanges() {
        #expect(UnifiedDiff.changedRanges("Date: Thursday", "Date: Thursday 10:00") == (nil, 14..<20))
        #expect(UnifiedDiff.changedRanges("let rate = 10", "let rate = 15") == (12..<13, 12..<13))
        #expect(UnifiedDiff.changedRanges("abc", "xyz") == (0..<3, 0..<3))
        #expect(UnifiedDiff.changedRanges("aa", "aaa") == (nil, 2..<3), "a repeated character is not counted twice")
        let diff = UnifiedDiff.make(old: "x\nlet rate = 10\nlet name = a\ny\n", new: "x\nlet rate = 15\ny\n")
        let lines = diff.hunks[0].lines
        #expect(lines.map(\.kind) == [.context, .removed, .removed, .added, .context])
        #expect(lines[1].changed == 12..<13 && lines[3].changed == 12..<13, "pairs by position in the change")
        #expect(lines[2].changed == nil, "a removed line with no added pair is not marked")
    }

    @Test("hidden characters become visible marks; tabs and emoji stay as they are")
    func visibleMarks() {
        let bidi = UnifiedDiff.segments("ab\u{202E}c", changed: nil)
        #expect(bidi == [.init(text: "ab", changed: false, mark: false), .init(text: "⟨U+202E⟩", changed: false, mark: true),
                         .init(text: "c", changed: false, mark: false)])
        #expect(UnifiedDiff.segments("a\r", changed: 1..<2) == [.init(text: "a", changed: false, mark: false), .init(text: "␍", changed: true, mark: true)])
        #expect(UnifiedDiff.segments("x\u{200B}\u{0}\u{7F}", changed: nil).map(\.text) == ["x", "⟨U+200B⟩␀␡"])
        #expect(UnifiedDiff.segments("\tok 👨‍👩‍👧", changed: nil) == [.init(text: "\tok 👨‍👩‍👧", changed: false, mark: false)])
        #expect(UnifiedDiff.segments("abc", changed: 1..<2).map(\.changed) == [false, true, false])
    }

    @Test("a question card never shows control or invisible bidi characters")
    func questionTextClean() throws {
        let json = #"{"chat":"c","turn":"\#(UUID().uuidString)","startedAt":"","elapsedMs":0,"state":"working","omitted":0,"calls":[],"#
            + #""questions":[{"id":"\#(UUID().uuidString)","prompt":"Del\u202Eete\u200B it?\u0007\nWhy","choices":["Ye\u2066s\uFEFF","\u200F","N\u0000o"],"state":"pending"}]}"#
        let question = try JSONDecoder().decode(ChatWorkSnapshot.self, from: Data(json.utf8)).questions[0]
        #expect(question.prompt == "Delete it?\nWhy")
        #expect(question.choices == ["Yes", "No"])
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
