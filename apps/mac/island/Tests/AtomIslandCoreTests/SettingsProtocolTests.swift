import Foundation
import Testing
@testable import AtomIslandCore

@Suite("Model settings protocol")
struct ModelSettingsProtocolTests {
    func fields(_ command: IslandCommand) throws -> [String: String]? {
        let line = command.line
        #expect(line.hasSuffix("\n"))
        #expect(!line.dropLast().contains("\n"))
        return try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: String]
    }

    @Test func modelSetCarriesProviderAndModel() throws {
        #expect(try fields(.modelSet(provider: "gemini", model: "gemini-3.6-flash"))
            == ["type": "model.set", "provider": "gemini", "model": "gemini-3.6-flash"])
        #expect(IslandCommand.modelSet(provider: "a", model: "b").type == "model.set")
    }

    @Test func modelSetEscapesAnyText() throws {
        let tricky = "say \"hi\"\\ \n line → काठमाडौं 🎙 / {}"
        #expect(try fields(.modelSet(provider: tricky, model: tricky))
            == ["type": "model.set", "provider": tricky, "model": tricky])
    }

    let infoLine = #"""
    {"type":"info","provider":"gemini","model":"gemini-3.6-flash","providers":[
      {"id":"gemini","name":"Gemini","available":true,"models":[{"id":"gemini-3.6-flash","name":"Gemini 3.6 Flash (fast)"},{"id":"gemini-3.5-pro","name":"Gemini 3.5 Pro"}]},
      {"id":"anthropic","name":"Claude","available":false,"models":[{"id":"claude-haiku-4-5","name":"Claude Haiku 4.5"}],"future":1}
    ]}
    """#.replacingOccurrences(of: "\n", with: "")

    @Test func decodesInfo() throws {
        let event = try decodeEvent(infoLine)
        let expected = ModelInfo(provider: "gemini", model: "gemini-3.6-flash", providers: [
            ProviderOption(id: "gemini", name: "Gemini", available: true, models: [
                ModelOption(id: "gemini-3.6-flash", name: "Gemini 3.6 Flash (fast)"),
                ModelOption(id: "gemini-3.5-pro", name: "Gemini 3.5 Pro"),
            ]),
            ProviderOption(id: "anthropic", name: "Claude", available: false, models: [
                ModelOption(id: "claude-haiku-4-5", name: "Claude Haiku 4.5"),
            ]),
        ])
        #expect(event == .info(expected))
        #expect(event.name == "info")
        #expect(expected.currentProvider?.name == "Gemini")
        #expect(expected.currentModelName == "Gemini 3.6 Flash (fast)") // the list's name wins
    }

    @Test func currentModelNameFallsBackToTheId() {
        let unlisted = ModelInfo(provider: "anthropic", model: "claude-haiku-4-5-20251001", providers: [
            ProviderOption(id: "anthropic", name: "Claude", available: true, models: []),
        ])
        #expect(unlisted.currentModelName == "Claude Haiku 4.5")
        let unknownProvider = ModelInfo(provider: "gemini", model: "gemini-3.6-flash", providers: [])
        #expect(unknownProvider.currentProvider == nil)
        #expect(unknownProvider.currentModelName == "Gemini 3.6 Flash")
    }

    @Test func rejectsMalformedInfo() {
        let cases: [(String, ProtocolError)] = [
            (#"{"type":"info","provider":"gemini","model":"m"}"#, .missingField(event: "info", field: "providers")),
            (#"{"type":"info","model":"m","providers":[]}"#, .missingField(event: "info", field: "provider")),
            (#"{"type":"info","provider":"p","model":"m","providers":{}}"#, .invalidValue(event: "info", field: "providers")),
            (#"{"type":"info","provider":"p","model":"m","providers":[{"id":"p","name":"P","models":[]}]}"#,
             .invalidValue(event: "info", field: "providers")), // no "available"
            (#"{"type":"info","provider":"p","model":"m","providers":[{"id":"p","name":"P","available":1,"models":[]}]}"#,
             .invalidValue(event: "info", field: "providers")), // a number, not a boolean
            (#"{"type":"info","provider":"p","model":"m","providers":[{"id":"p","name":"P","available":true,"models":[{"id":"m"}]}]}"#,
             .invalidValue(event: "info", field: "providers")), // a model without a name
            (#"{"type":"info","provider":"p","model":"m","providers":["p"]}"#, .invalidValue(event: "info", field: "providers")),
        ]
        for (line, expected) in cases {
            #expect(throws: expected, "\(line)") { try decodeEvent(line) }
        }
    }

    @Test func emptyProviderListIsValid() throws {
        #expect(try decodeEvent(#"{"type":"info","provider":"p","model":"m","providers":[]}"#)
            == .info(ModelInfo(provider: "p", model: "m", providers: [])))
    }
}

@Suite("IslandStatus details")
struct IslandStatusDetailTests {
    let ready = IslandEvent.ready(ReadyInfo(protocolVersion: 1, provider: "gemini", model: "gemini-3.6-flash", microphone: ":Webcam", voice: false))
    let claude = ModelInfo(provider: "anthropic", model: "claude-haiku-4-5", providers: [
        ProviderOption(id: "anthropic", name: "Claude", available: true, models: [ModelOption(id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (cheap)")]),
    ])

    @Test func readyFillsTheStatusTab() {
        var status = IslandStatus()
        status.apply(ready)
        #expect(status.microphone == ":Webcam")
        #expect(status.provider == "gemini" && status.model == "gemini-3.6-flash")
        #expect(!status.voiceLoaded)
        #expect(status.lastTimings == nil && status.lastProblem == nil)
    }

    @Test func infoUpdatesTheModelAndTheReadyLine() {
        var status = IslandStatus()
        status.apply(ready)
        status.apply(.info(claude))
        #expect(status.modelName == "Claude Haiku 4.5 (cheap)")
        #expect(status.detail == "Claude Haiku 4.5 (cheap)")
        #expect(status.provider == "anthropic" && status.model == "claude-haiku-4-5")
        #expect(status.microphone == ":Webcam") // untouched by info
    }

    @Test func infoDuringATurnChangesOnlyTheName() {
        var status = IslandStatus()
        status.apply(ready)
        status.apply(.state(.listening))
        status.apply(.info(claude))
        #expect(status.kind == .listening && status.detail == "")
        status.apply(.state(.thinking))
        #expect(status.detail == "Claude Haiku 4.5 (cheap)")
    }

    @Test func aRefusedModelSwitchIsAPassingProblem() {
        var status = IslandStatus()
        status.apply(ready)
        status.apply(.error(RuntimeError(stage: "settings", message: "No API key for Claude. Add ANTHROPIC_API_KEY to .env.")))
        #expect(status.kind == .problem && status.title == "Can't switch model")
        #expect(status.detail == "No API key for Claude")
        status.acknowledge()
        #expect(status.kind == .ready)
    }

    @Test func lastProblemKeepsTheFullMessageUntilTheNextError() {
        var status = IslandStatus()
        status.apply(ready)
        let message = "Gemini's daily free limit is used up. Try again after 16:00, or switch to Claude in Settings."
        status.apply(.error(RuntimeError(stage: "model", message: message, kind: "rate_limit")))
        #expect(status.lastProblem == IslandStatus.Problem(title: "Model limit reached", message: message))
        status.acknowledge()
        status.apply(.state(.listening))
        status.apply(ready)
        #expect(status.lastProblem?.message == message) // history, not the current state
        status.apply(.error(RuntimeError(stage: "speech", message: "Audio output failed.")))
        #expect(status.lastProblem == IslandStatus.Problem(title: "Couldn't speak", message: "Audio output failed."))
    }

    @Test func keepsTheLastTimings() {
        var status = IslandStatus()
        let first = TurnTimings(speechMs: 1, transcriptionMs: 2, modelMs: 3, firstSoundMs: 4)
        let second = TurnTimings(speechMs: 5, transcriptionMs: 6, modelMs: 7, firstSoundMs: nil)
        status.apply(.turnComplete(first))
        #expect(status.lastTimings == first)
        status.apply(.turnComplete(second))
        #expect(status.lastTimings == second)
    }
}


@Suite("Memory protocol")
struct MemoryProtocolTests {
    func object(_ command: IslandCommand) throws -> [String: Any] {
        let line = command.line
        #expect(line.hasSuffix("\n") && !line.dropLast().contains("\n"))
        return try #require(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
    }

    @Test func commands() throws {
        #expect(try object(.memoryList) as? [String: String] == ["type": "memory.list"])
        #expect(try object(.memoryClear) as? [String: String] == ["type": "memory.clear"])
        let forget = try object(.memoryForget(id: 12))
        #expect(forget["type"] as? String == "memory.forget")
        let id = try #require(forget["id"] as? NSNumber)
        #expect(id.intValue == 12 && CFGetTypeID(id) != CFBooleanGetTypeID()) // a number, not "12"
    }

    @Test func decodesMemoryNewestFirst() throws {
        let line = #"{"type":"memory","enabled":true,"count":2,"memories":[{"id":2,"text":"Keshab drinks tea.","createdAt":"2026-10-04T01:02:03.456Z","source":"voice"},{"id":1,"text":"Sister: Asha","createdAt":"bad","source":"text","extra":1}]}"#
        guard case .memory(let list) = try decodeEvent(line) else { Issue.record("not memory"); return }
        #expect(list.enabled && list.count == 2)
        #expect(list.memories.map(\.id) == [2, 1])
        #expect(list.memories[0].text == "Keshab drinks tea.")
        #expect(list.memories[0].createdAt == Date(timeIntervalSince1970: 1_791_075_723.456))
        #expect(list.memories[1].createdAt == nil) // an unreadable date is dropped, the fact is kept
        #expect(list.memories[1].source == "text")
        #expect(IslandEvent.memory(list).name == "memory") // never the text
    }

    @Test func memoryOffAndBadLists() throws {
        #expect(try decodeEvent(#"{"type":"memory","enabled":false,"count":0,"memories":[]}"#) == .memory(MemoryList(enabled: false, count: 0, memories: [])))
        #expect(throws: ProtocolError.missingField(event: "memory", field: "memories")) {
            try decodeEvent(#"{"type":"memory","enabled":true,"count":0}"#)
        }
        #expect(throws: ProtocolError.invalidValue(event: "memory", field: "memories")) {
            try decodeEvent(#"{"type":"memory","enabled":true,"count":1,"memories":[{"id":"1","text":"x"}]}"#)
        }
        #expect(throws: ProtocolError.invalidValue(event: "memory", field: "memories")) {
            try decodeEvent(#"{"type":"memory","enabled":true,"count":1,"memories":[{"id":true,"text":"x"}]}"#)
        }
    }

    @Test func episodesAreDecodedAndOptional() throws {
        let line = #"{"type":"memory","enabled":true,"count":0,"memories":[],"episodes":[{"id":4,"summary":"The user planned Kyoto.","endedAt":"2026-10-04T01:02:03.456Z","exchanges":3}]}"#
        guard case .memory(let list) = try decodeEvent(line) else { Issue.record("not memory"); return }
        #expect(list.episodes == [EpisodeItem(id: 4, summary: "The user planned Kyoto.", endedAt: Date(timeIntervalSince1970: 1_791_075_723.456), exchanges: 3)])
        // An older runtime sends no episodes at all.
        guard case .memory(let old) = try decodeEvent(#"{"type":"memory","enabled":true,"count":0,"memories":[]}"#) else { return }
        #expect(old.episodes.isEmpty)
        #expect(throws: ProtocolError.invalidValue(event: "memory", field: "episodes")) {
            try decodeEvent(#"{"type":"memory","enabled":true,"count":0,"memories":[],"episodes":[{"id":1}]}"#)
        }
        let forget = try object(.episodeForget(id: 4))
        #expect(forget["type"] as? String == "episode.forget" && (forget["id"] as? NSNumber)?.intValue == 4)
        #expect(try object(.episodeClear) as? [String: String] == ["type": "episode.clear"])
    }
}

@Suite struct TimerEventTests {
    @Test func timerDecodesAndShowsAsNotice() throws {
        let event = try decodeEvent(#"{"type":"timer","id":3,"label":"pasta","message":"Your pasta timer is done."}"#)
        #expect(event == .timer(id: 3, label: "pasta", message: "Your pasta timer is done."))
        var status = IslandStatus()
        status.apply(.ready(ReadyInfo(protocolVersion: 1, provider: "claude-plan", model: "claude-haiku-4-5", microphone: ":default", voice: true)))
        status.apply(event)
        #expect(status.kind == .notice && status.title == "Timer done" && status.detail == "Pasta")
        // During a turn, the turn's status stays.
        status.apply(.state(.thinking))
        status.apply(.timer(id: 4, label: "", message: "Your timer is done."))
        #expect(status.kind == .thinking)
    }
}

@Suite struct TextSendTests {
    @Test func textSendEncodesTheTextEscaped() throws {
        let line = IslandCommand.textSend("say \"hi\"\nplease").line
        let object = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: String]
        #expect(object == ["type": "text.send", "text": "say \"hi\"\nplease"])
    }
}

@Suite struct ContextWindowProtocolTests {
    @Test func contextWindowEncodesTheAppOnly() throws {
        let line = IslandCommand.contextWindow(bundleId: "com.brave.Browser", name: "Brave Browser").line
        #expect(line.hasSuffix("\n") && !line.dropLast().contains("\n"))
        let object = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: String]
        #expect(object == ["type": "context.window", "bundleId": "com.brave.Browser", "name": "Brave Browser"])
        #expect(IslandCommand.contextWindow(bundleId: "a", name: "b").type == "context.window")
    }

    @Test func contextReadyDecodes() throws {
        #expect(try decodeEvent(#"{"type":"context.ready","app":"Brave Browser","ok":true}"#)
            == .contextReady(app: "Brave Browser", ok: true, message: nil))
        let refused = try decodeEvent(#"{"type":"context.ready","app":"Terminal","ok":false,"message":"ZENO doesn't read Terminal."}"#)
        #expect(refused == .contextReady(app: "Terminal", ok: false, message: "ZENO doesn't read Terminal."))
        #expect(refused.name == "context.ready") // never the app or message
        #expect(throws: ProtocolError.missingField(event: "context.ready", field: "ok")) {
            try decodeEvent(#"{"type":"context.ready","app":"Terminal"}"#)
        }
        #expect(throws: ProtocolError.invalidValue(event: "context.ready", field: "ok")) {
            try decodeEvent(#"{"type":"context.ready","app":"Terminal","ok":"yes"}"#)
        }
    }

    @Test func contextReadyInTheBubble() {
        var status = IslandStatus()
        status.apply(.ready(ReadyInfo(protocolVersion: 1, provider: "claude-plan", model: "claude-haiku-4-5", microphone: ":default", voice: true)))
        status.apply(.contextReady(app: "Terminal", ok: false, message: "ZENO doesn't read Terminal."))
        #expect(status.kind == .notice && status.title == "ZENO doesn't read Terminal.")
        // The microphone opened first: listening, with the app named under it.
        status.apply(.state(.listening))
        status.apply(.contextReady(app: "Brave Browser", ok: true, message: nil))
        #expect(status.kind == .listening && status.detail == "Ask about Brave Browser")
        // No microphone: a notice says how to ask.
        status.apply(.state(.idle))
        status.acknowledge()
        status.apply(.contextReady(app: "Brave Browser", ok: true, message: nil))
        #expect(status.kind == .notice && status.title == "Ask about Brave Browser")
    }
}
