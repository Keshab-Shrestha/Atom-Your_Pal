import Foundation
import Testing
@testable import ArkIslandCore

/// ADR-276: notes on a work plan, the message Send notes writes into the composer, and how the notes are kept.
@Suite("Plan notes")
struct PlanNotesTests {
    static let portions = [
        PlanPortion(n: 1, agent: "sid", name: "Sid", task: "Collect the sources"),
        PlanPortion(n: 2, agent: "quill", name: "Quill", task: "Write the \"launch\" notes\nfor the blog", after: [1]),
    ]

    @Test func aNoteNeedsAMarkOrWords() {
        #expect(PlanNote(portion: 1, mark: nil, text: "  \n ") == nil)
        #expect(PlanNote(portion: 1, mark: .clarify, text: "")?.text == "")
        #expect(PlanNote(portion: 1, mark: nil, text: String(repeating: "a", count: 2_000))?.text.count == PlanNote.maxText)
    }

    @Test func theMessageIsNumberedInPortionOrder() throws {
        let notes = [
            try #require(PlanNote(portion: 2, mark: .clarify, text: "Which audience?")),
            try #require(PlanNote(portion: 1, mark: .looksGood, text: "")),
            try #require(PlanNote(portion: 2, mark: nil, text: "Keep it\nshort")),
            try #require(PlanNote(portion: 9, mark: .needsTests, text: "Gone step")),
        ]
        #expect(PlanNotes.message(goal: "Cedar launch", notes: notes, portions: Self.portions) == """
        Notes on the plan "Cedar launch":
        1. [Looks good] P1 — "Collect the sources"
        2. [Clarify] P2 — "Write the 'launch' notes for the blog": Which audience?
        3. P2 — "Write the 'launch' notes for the blog": Keep it short
        4. [Needs tests] P9: Gone step
        """)
        #expect(PlanNotes.message(goal: "Cedar", notes: [], portions: Self.portions) == nil)
    }

    @Test func aLongStepIsQuotedShort() throws {
        let long = [PlanPortion(n: 1, agent: "a", name: "A", task: String(repeating: "x", count: 400))]
        let note = try #require(PlanNote(portion: 1, mark: .clarify, text: ""))
        let message = try #require(PlanNotes.message(goal: "G", notes: [note], portions: long))
        #expect(message.contains("\"" + String(repeating: "x", count: PlanNote.maxQuote - 1) + "…\""))
    }

    @Test func everyLineBreakAndQuoteStaysOnOneLine() throws {
        let note = try #require(PlanNote(portion: 1, mark: nil, text: "a\rb\u{2028}c\r\nd"))
        let goal = "The \"big\"\ngoal " + String(repeating: "g", count: 200)
        let message = try #require(PlanNotes.message(goal: goal, notes: [note], portions: Self.portions))
        let lines = message.split(whereSeparator: \.isNewline)
        #expect(lines.count == 2)
        #expect(lines[1] == "1. P1 — \"Collect the sources\": a b c d")
        #expect(lines[0].hasPrefix("Notes on the plan \"The 'big' goal ggg"))
        #expect(lines[0].count == "Notes on the plan \"\":".count + PlanNote.maxGoal)
        #expect(lines[0].hasSuffix("…\":"))
    }

    @Test func theMessageGoesAfterTheDraft() {
        #expect(PlanNotes.appending("N", to: "") == "N\n")
        #expect(PlanNotes.appending("N", to: "Hi") == "Hi\n\nN\n")
        #expect(PlanNotes.appending("N", to: "Hi\n") == "Hi\n\nN\n")
        #expect(PlanNotes.appending("N", to: "Hi\n\n") == "Hi\n\nN\n")
    }

    @MainActor @Test func notesPersistPerPlanAndGoal() throws {
        let suite = "ark.test.plan-notes.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let note = try #require(PlanNote(portion: 2, mark: .needsTests, text: "Cover retries"))
        let settings = IslandSettings(defaults: defaults)
        settings.planNotes = settings.planNotes.saving([note], plan: 7, goal: "Cedar launch")

        let reopened = IslandSettings(defaults: defaults)
        #expect(reopened.planNotes.notes(plan: 7, goal: "Cedar launch") == [note])
        #expect(reopened.planNotes.notes(plan: 7, goal: "Another goal").isEmpty, "a reused plan number starts empty")
        #expect(reopened.planNotes.notes(plan: 8, goal: "Cedar launch").isEmpty)
        reopened.planNotes = reopened.planNotes.saving([], plan: 7, goal: "Cedar launch")
        #expect(IslandSettings(defaults: defaults).planNotes == PlanNoteBook())
    }

    @Test func theBookKeepsTheNewestPlans() throws {
        let note = try #require(PlanNote(portion: 1, mark: .clarify, text: ""))
        var book = PlanNoteBook()
        for plan in 0...PlanNoteBook.maxPlans { book = book.saving([note], plan: plan, goal: "G") }
        #expect(book.sets.count == PlanNoteBook.maxPlans)
        #expect(book.notes(plan: 0, goal: "G").isEmpty)
        #expect(book.notes(plan: PlanNoteBook.maxPlans, goal: "G") == [note])
        book = book.saving(Array(repeating: note, count: PlanNoteBook.maxNotesPerPlan + 5), plan: 1, goal: "G")
        #expect(book.notes(plan: 1, goal: "G").count == PlanNoteBook.maxNotesPerPlan)
    }
}
