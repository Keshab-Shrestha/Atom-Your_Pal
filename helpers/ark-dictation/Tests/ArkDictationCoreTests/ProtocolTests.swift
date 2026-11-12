import XCTest
@testable import ArkDictationCore

final class FakeAudio: MicSource, @unchecked Sendable {
    var onLevel: (@Sendable (Float) -> Void)?
    var clip: [Float]
    var failStart = false
    var log: [String] = []
    init(clip: [Float]) { self.clip = clip }
    func start() throws {
        log.append("start")
        if failStart { throw NSError(domain: "mic", code: 1, userInfo: [NSLocalizedDescriptionKey: "no microphone"]) }
        onLevel?(0.5)
    }
    func stop() -> [Float] { log.append("stop"); return clip }
}

struct FakeModel: Transcriber {
    var text: String
    func transcribe(_ samples: [Float]) async throws -> String {
        XCTAssertGreaterThanOrEqual(samples.count, Audio.minimumSamples)
        return text
    }
}

final class Events: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [Event] = []
    func add(_ e: Event) { lock.lock(); items.append(e); lock.unlock() }
    var all: [Event] { lock.lock(); defer { lock.unlock() }; return items }
}

final class ProtocolTests: XCTestCase {
    private let speech = [Float](repeating: 0.1, count: 16_000)

    func testCommandsParse() {
        XCTAssertEqual(Command.parse(#"{"cmd":"start"}"#), .start)
        XCTAssertEqual(Command.parse(#"{"cmd": "stop", "x": 1}"#), .stop)
        XCTAssertEqual(Command.parse(#"{"cmd":"cancel"}"#), .cancel)
        XCTAssertNil(Command.parse(#"{"cmd":"format"}"#))
        XCTAssertNil(Command.parse("not json"))
        XCTAssertNil(Command.parse(#"{"nope":1}"#))
    }

    func testEventsEncodeAsOneLine() {
        XCTAssertEqual(Event.level(2).line, #"{"peak":1,"type":"level"}"#)
        XCTAssertEqual(Event.transcript("say \"hi\"\n").line, #"{"text":"say \"hi\"\n","type":"transcript"}"#)
        XCTAssertEqual(Event.error("bad").line, #"{"message":"bad","type":"error"}"#)
        XCTAssertFalse(Event.ready.line.contains("\n"))
    }

    func testStartThenStopGivesLevelsAndATrimmedTranscript() async {
        let events = Events()
        let audio = FakeAudio(clip: speech)
        let session = Session(audio: audio, model: FakeModel(text: "  hello there "), emit: events.add)
        await session.handle(.start)
        await session.handle(.stop)
        XCTAssertEqual(events.all, [.level(0.5), .transcript("hello there")])
        XCTAssertEqual(audio.log, ["start", "stop"])
    }

    func testSilenceGivesAnEmptyTranscriptWithoutTheModel() async {
        let events = Events()
        let session = Session(audio: FakeAudio(clip: [Float](repeating: 0, count: 16_000)), model: FakeModel(text: "invented"), emit: events.add)
        await session.handle(.start)
        await session.handle(.stop)
        XCTAssertEqual(events.all.last, .transcript(""))
    }

    func testCancelDropsAudioAndStopWithoutStartIsAnError() async {
        let events = Events()
        let audio = FakeAudio(clip: speech)
        let session = Session(audio: audio, model: FakeModel(text: "x"), emit: events.add)
        await session.handle(.start)
        await session.handle(.cancel)
        await session.handle(.stop)
        XCTAssertEqual(audio.log, ["start", "stop"])
        XCTAssertEqual(events.all.last, .error("The microphone was not on."))
    }

    func testAMicrophoneFailureBecomesAnErrorLine() async {
        let events = Events()
        let audio = FakeAudio(clip: [])
        audio.failStart = true
        let session = Session(audio: audio, model: FakeModel(text: ""), emit: events.add)
        await session.handle(.start)
        guard case .error(let message)? = events.all.last else { return XCTFail("no error") }
        XCTAssertTrue(message.contains("no microphone"))
    }
}
