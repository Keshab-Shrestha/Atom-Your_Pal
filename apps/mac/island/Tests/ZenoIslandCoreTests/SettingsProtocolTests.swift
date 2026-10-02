import Foundation
import Testing
@testable import ZenoIslandCore

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
        status.apply(.error(RuntimeError(stage: "model", message: message, kind: "rate_limit", retryable: true)))
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
        let first = TurnTimings(speechMs: 1, transcriptionMs: 2, modelMs: 3, firstSoundMs: 4, requestId: "r1")
        let second = TurnTimings(speechMs: 5, transcriptionMs: 6, modelMs: 7, firstSoundMs: nil, requestId: nil)
        status.apply(.turnComplete(first))
        #expect(status.lastTimings == first)
        status.apply(.turnComplete(second))
        #expect(status.lastTimings == second)
    }
}
