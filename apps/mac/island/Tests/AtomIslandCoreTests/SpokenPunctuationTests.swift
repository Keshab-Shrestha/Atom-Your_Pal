import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Spoken punctuation")
struct SpokenPunctuationTests {
    private func english(_ text: String) -> String { SpokenPunctuation.apply(to: text) }

    @Test func commaAndQuestionMark() {
        #expect(english("Hello comma how are you question mark") == "Hello, how are you?")
    }

    @Test func engineAlreadyAddedPunctuationAroundTheWord() {
        #expect(english("Hello, comma, how are you? Question mark.") == "Hello, how are you?")
    }

    @Test func newLineAndNewParagraph() {
        #expect(english("First line new line second line new paragraph third") == "First line\nSecond line\n\nThird")
    }

    @Test func periodOnlyAtTheEnd() {
        #expect(english("That is the end period") == "That is the end.")
        #expect(english("The period of time was short") == "The period of time was short")
    }

    @Test func fullStopCapitalisesTheNextSentence() {
        #expect(english("Done full stop next thing") == "Done. Next thing")
    }

    @Test func wordsInsideOtherWordsAreLeftAlone() {
        #expect(english("The colonel commanded") == "The colonel commanded")
    }

    @Test func plainTextIsUntouched() {
        #expect(english("Nothing special here.") == "Nothing special here.")
    }
}
