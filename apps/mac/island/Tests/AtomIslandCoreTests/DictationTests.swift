import Foundation
import Testing
@testable import AtomIslandCore

/// A sine wave at `amplitude` for `seconds`, at 16 kHz: stands in for speech.
private func tone(_ seconds: Double, amplitude: Float = 0.2) -> [Float] {
    (0..<Int(seconds * 16_000)).map { amplitude * sin(Float($0) * 0.1) }
}

private func silence(_ seconds: Double) -> [Float] {
    [Float](repeating: 0, count: Int(seconds * 16_000))
}

@Suite("Dictation audio rules")
struct DictationAudioTests {
    @Test func shortClipsArePaddedWithSilenceToOneSecond() {
        let clip = tone(0.4)
        let padded = DictationAudio.padded(clip)
        #expect(padded.count == 16_000)
        #expect(Array(padded.prefix(clip.count)) == clip, "the speech is untouched")
        #expect(padded.suffix(1000).allSatisfy { $0 == 0 })
    }

    @Test func longClipsAreLeftAlone() {
        let clip = tone(3)
        #expect(DictationAudio.padded(clip) == clip)
        #expect(DictationAudio.padded(tone(1)).count == 16_000)
    }

    @Test func secondsFromSamples() {
        #expect(DictationAudio.seconds(tone(2.5)) == 2.5)
        #expect(DictationAudio.seconds([]) == 0)
    }

    @Test func speechIsDetected() {
        #expect(DictationAudio.hasSpeech(tone(1)))
        #expect(DictationAudio.hasSpeech(tone(1, amplitude: 0.02)), "quiet speech counts")
    }

    @Test func silenceAndHissAreNotSpeech() {
        #expect(!DictationAudio.hasSpeech([]))
        #expect(!DictationAudio.hasSpeech(silence(2)))
        #expect(!DictationAudio.hasSpeech(tone(2, amplitude: 0.003)), "room noise is not speech")
    }

    @Test func aClickIsNotSpeech() {
        // 50 ms of sound is a key click or a bump, not a word.
        #expect(!DictationAudio.hasSpeech(silence(1) + tone(0.05) + silence(1)))
    }

    @Test func speechInTheMiddleOfSilenceIsFound() {
        #expect(DictationAudio.hasSpeech(silence(1) + tone(0.5) + silence(1)))
    }

    @Test func clippingIsDetected() {
        #expect(DictationAudio.clipped(tone(1, amplitude: 1.0)))
        #expect(!DictationAudio.clipped(tone(1, amplitude: 0.5)))
        #expect(DictationAudio.peak(tone(1, amplitude: 0.25)) <= 0.25)
        #expect(DictationAudio.peak([]) == 0)
    }
}

@Suite("Dictation vocabulary")
struct DictationVocabularyTests {
    @Test func aliasBecomesTheTerm() {
        let vocabulary = DictationVocabulary(entries: [.init(term: "ZENO", aliases: ["zino", "zeeno"])])
        #expect(vocabulary.apply(to: "Hey Zino, are you there?") == "Hey ZENO, are you there?")
        #expect(vocabulary.apply(to: "zeeno") == "ZENO")
    }

    @Test func onlyWholeWords() {
        let vocabulary = DictationVocabulary(entries: [.init(term: "ZENO", aliases: ["zino"])])
        #expect(vocabulary.apply(to: "A zinotype and zinos") == "A zinotype and zinos")
        #expect(vocabulary.apply(to: "(zino) said, zino.") == "(ZENO) said, ZENO.")
    }

    @Test func anApostropheJoinsAWordToItsNeighbour() {
        let vocabulary = DictationVocabulary(entries: [.init(term: "ZENO", aliases: ["zino"])])
        #expect(vocabulary.apply(to: "zino's") == "zino's", "a possessive is not rewritten as the bare term")
    }

    @Test func caseIsIgnoredInTheTextAndKeptInTheTerm() {
        let vocabulary = DictationVocabulary.parse("Kokoro\nFluidVoice: fluid voice, fluid boys")
        #expect(vocabulary.apply(to: "kokoro and KOKORO") == "Kokoro and Kokoro")
        #expect(vocabulary.apply(to: "I use fluid voice") == "I use FluidVoice")
        #expect(vocabulary.apply(to: "Fluid Boys!") == "FluidVoice!")
    }

    @Test func longerAliasesWinOverShorterOnes() {
        let vocabulary = DictationVocabulary(entries: [
            .init(term: "Fluid", aliases: ["fluid"]),
            .init(term: "FluidVoice", aliases: ["fluid voice"]),
        ])
        #expect(vocabulary.apply(to: "fluid voice") == "FluidVoice")
        #expect(vocabulary.apply(to: "fluid") == "Fluid")
    }

    @Test func specialCharactersInAliasesAreLiteral() {
        let vocabulary = DictationVocabulary(entries: [.init(term: "Whisper.cpp", aliases: ["whisper dot cpp", "c++"])])
        #expect(vocabulary.apply(to: "whisper dot cpp") == "Whisper.cpp")
        #expect(vocabulary.apply(to: "I like c++ a lot") == "I like Whisper.cpp a lot".replacingOccurrences(of: "Whisper.cpp", with: "Whisper.cpp"))
        #expect(vocabulary.apply(to: "whisperXdotXcpp") == "whisperXdotXcpp", "dots and plus signs are not wildcards")
    }

    @Test func emptyVocabularyChangesNothing() {
        #expect(DictationVocabulary().apply(to: "Hello there") == "Hello there")
        #expect(DictationVocabulary.builtIn.apply(to: "") == "")
    }

    @Test func theBuiltInListFixesZeno() {
        #expect(DictationVocabulary.builtIn.apply(to: "Hello Zino, this is a test") == "Hello ZENO, this is a test")
    }

    @Test func parsingFileFormat() {
        let text = """
        # Names and tools
        ZENO: zeno, zino   # the assistant
        Keshab Shrestha: kesha shrestha, keshab shresta

        Kokoro
        """
        let vocabulary = DictationVocabulary.parse(text)
        #expect(vocabulary.problems.isEmpty)
        #expect(vocabulary.entries == [
            .init(term: "ZENO", aliases: ["zeno", "zino"]),
            .init(term: "Keshab Shrestha", aliases: ["kesha shrestha", "keshab shresta"]),
            .init(term: "Kokoro", aliases: ["Kokoro"]),
        ])
    }

    @Test func badLinesAreReportedAndSkipped() {
        let vocabulary = DictationVocabulary.parse("good: a\n: orphan\nalso good")
        #expect(vocabulary.entries.map(\.term) == ["good", "also good"])
        #expect(vocabulary.problems == ["line 2: no word before the colon"])
    }

    @Test func mergingKeepsBothAndTheProblems() {
        let merged = DictationVocabulary.builtIn.merging(DictationVocabulary.parse("Kokoro\n: bad"))
        #expect(merged.entries.map(\.term) == ["ZENO", "Kokoro"])
        #expect(merged.problems.count == 1)
        #expect(merged.apply(to: "zino likes kokoro") == "ZENO likes Kokoro")
    }
}

@Suite("Dictation on the island")
struct DictationStatusTests {
    private func status(_ phases: DictationPhase...) -> IslandStatus {
        var status = IslandStatus()
        for phase in phases { status.apply(phase) }
        return status
    }

    @Test func listeningShowsTheLevelMeter() {
        let s = status(.listening)
        #expect(s.kind == .listening && s.title == "Dictating" && s.showsLevel && s.isBusy)
    }

    @Test func transcribingIsBusyWithoutTheMeter() {
        let s = status(.listening, .transcribing)
        #expect(s.kind == .transcribing && !s.showsLevel && s.isBusy)
    }

    @Test func typedReportsTheWordCount() {
        #expect(status(.done(.typed(words: 12))).detail == "12 words")
        #expect(status(.done(.typed(words: 1))).detail == "1 word")
        let done = status(.done(.typed(words: 3)))
        #expect(done.kind == .ready && done.title == "Typed" && !done.isBusy && !done.needsAttention)
    }

    @Test func copiedIsANoticeThatSaysWhy() {
        let s = status(.done(.copied(reason: "A password field is focused. Paste it yourself")))
        #expect(s.kind == .notice && s.needsAttention && s.title == "Copied to clipboard")
        #expect(s.detail.contains("password field"))
    }

    @Test func nothingHeardAndTooShortAreNotices() {
        #expect(status(.done(.noSpeech)).title == "Didn't catch that")
        #expect(status(.done(.tooShort)).title == "Too short")
        #expect(status(.done(.busy)).kind == .notice)
    }

    @Test func aFailureIsAProblemWithItsFullMessage() {
        let s = status(.done(.failed(title: "Couldn't transcribe", message: "The speech model is missing. Run: pnpm models")))
        #expect(s.kind == .problem && s.needsAttention)
        #expect(s.lastProblem?.message == "The speech model is missing. Run: pnpm models")
        #expect(s.detail == "The speech model is missing")
    }

    @Test func cancellingGoesBackToReady() {
        let s = status(.listening, .cancelled)
        #expect(s.kind == .ready && !s.isBusy)
    }

    @Test func loadingTheModelShowsStarting() {
        let s = status(.loading(detail: "First use, about 20 seconds"))
        #expect(s.kind == .starting && s.title == "Loading speech" && s.detail == "First use, about 20 seconds")
    }
}
