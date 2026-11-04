import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Dictation tidy")
struct DictationTidyTests {
    private let raw = "so i met sarah at 3 30 on tuesday and she said the report is due on march 12 which is fine"

    @Test("punctuation and capitals are accepted")
    func acceptsTidying() {
        #expect(DictationTidy.accepts(raw: raw, tidy: "So I met Sarah at 3 30 on Tuesday, and she said the report is due on March 12, which is fine."))
    }

    @Test("a changed number, a lost name or a rewrite is refused")
    func refusesMeaningChanges() {
        #expect(!DictationTidy.accepts(raw: raw, tidy: "So I met Sarah at 3 30 on Tuesday, and she said the report is due on March 21, which is fine."))
        #expect(!DictationTidy.accepts(raw: raw, tidy: "So I met someone at 3 30 on Tuesday, and she said the report is due on March 12, which is fine."))
        #expect(!DictationTidy.accepts(raw: raw, tidy: "Sarah told me on Tuesday afternoon that the quarterly report must be submitted by the twelfth of March."))
    }

    @Test("nothing new that looks like a link or a handle, no empty or unchanged answer, no runaway length")
    func refusesAdditions() {
        #expect(!DictationTidy.accepts(raw: raw, tidy: raw + " See https://evil.test"))
        #expect(!DictationTidy.accepts(raw: raw, tidy: ""))
        #expect(!DictationTidy.accepts(raw: raw, tidy: raw))
        #expect(!DictationTidy.accepts(raw: raw, tidy: raw + String(repeating: " and more words", count: 10)))
    }

    @Test("a spelling slip may be fixed; a different word may not")
    func slipFix() {
        #expect(DictationTidy.accepts(raw: "i think there going to send the contract to the lawyer on friday morning", tidy: "I think they're going to send the contract to the lawyer on Friday morning."))
        #expect(!DictationTidy.accepts(raw: "i think there going to send the contract to the lawyer on friday morning", tidy: "I think there going to send the invoice to the lawyer on Friday morning."))
    }

    @Test("thousands commas are the same number")
    func sameNumber() {
        #expect(DictationTidy.accepts(raw: "we spent 1200 dollars on the new laptop for the office today", tidy: "We spent 1,200 dollars on the new laptop for the office today."))
    }
}
