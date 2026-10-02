import Foundation
import Testing
@testable import ZenoIslandCore

@Suite("Protocol")
struct ProtocolTests {
    @Test func commandsAreOneJSONLine() throws {
        for command in IslandCommand.allCases {
            let line = command.line
            #expect(line.hasSuffix("\n"))
            #expect(!line.dropLast().contains("\n"))
            let object = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: String]
            #expect(object == ["type": command.rawValue])
        }
        #expect(IslandCommand.talkStart.line == "{\"type\":\"talk.start\"}\n")
    }

    @Test func decodesEveryEvent() throws {
        let cases: [(String, IslandEvent)] = [
            (#"{"type":"ready","protocol":1,"provider":"gemini","model":"gemini-3.6-flash","microphone":":default","voice":true}"#,
             .ready(ReadyInfo(protocolVersion: 1, provider: "gemini", model: "gemini-3.6-flash", microphone: ":default", voice: true))),
            (#"{"type":"state","state":"thinking"}"#, .state(.thinking)),
            (#"{"type":"mic.ready"}"#, .micReady),
            (#"{"type":"mic.level","peak":0.284}"#, .micLevel(0.284)),
            (#"{"type":"mic.silent","microphone":"macOS default: External Microphone"}"#, .micSilent(microphone: "macOS default: External Microphone")),
            (#"{"type":"transcript","text":"What is the capital of Japan?"}"#, .transcript("What is the capital of Japan?")),
            (#"{"type":"reply","text":"Line one.\nLine two."}"#, .reply("Line one.\nLine two.")),
            (#"{"type":"turn.complete","speechMs":1840,"transcriptionMs":560,"modelMs":1420,"firstSoundMs":910,"requestId":"r1"}"#,
             .turnComplete(TurnTimings(speechMs: 1840, transcriptionMs: 560, modelMs: 1420, firstSoundMs: 910, requestId: "r1"))),
            (#"{"type":"turn.complete","speechMs":1,"transcriptionMs":2,"modelMs":3}"#,
             .turnComplete(TurnTimings(speechMs: 1, transcriptionMs: 2, modelMs: 3, firstSoundMs: nil, requestId: nil))),
            (#"{"type":"notice","kind":"too_short","message":"Too short."}"#, .notice(kind: "too_short", message: "Too short.")),
            (#"{"type":"conversation.reset"}"#, .conversationReset),
            (#"{"type":"error","stage":"model","message":"quota","kind":"rate_limit","retryable":true}"#,
             .error(RuntimeError(stage: "model", message: "quota", kind: "rate_limit", retryable: true))),
            (#"{"type":"error","stage":"config","message":"ANTHROPIC_API_KEY is required"}"#,
             .error(RuntimeError(stage: "config", message: "ANTHROPIC_API_KEY is required", kind: nil, retryable: nil))),
        ]
        for (line, expected) in cases {
            #expect(try decodeEvent(line) == expected, "\(line)")
        }
    }

    @Test func ignoresExtraFieldsAndUnknownEvents() throws {
        #expect(try decodeEvent(#"{"type":"state","state":"idle","future":[1,2]}"#) == .state(.idle))
        #expect(try decodeEvent(#"{"type":"tool.call","name":"x"}"#) == .unknown(type: "tool.call"))
    }

    @Test func clampsLevelsToZeroToOne() throws {
        #expect(try decodeEvent(#"{"type":"mic.level","peak":1.7}"#) == .micLevel(1))
        #expect(try decodeEvent(#"{"type":"mic.level","peak":-0.2}"#) == .micLevel(0))
    }

    @Test func rejectsMalformedLines() {
        let cases: [(String, ProtocolError)] = [
            ("not json", .notJSON),
            ("[1,2]", .notJSON),
            (#""state""#, .notJSON),
            (#"{"state":"idle"}"#, .missingType),
            (#"{"type":7}"#, .missingType),
            (#"{"type":"state"}"#, .missingField(event: "state", field: "state")),
            (#"{"type":"state","state":"dancing"}"#, .invalidValue(event: "state", field: "state")),
            (#"{"type":"mic.level","peak":"loud"}"#, .invalidValue(event: "mic.level", field: "peak")),
            (#"{"type":"mic.level","peak":true}"#, .invalidValue(event: "mic.level", field: "peak")),
            (#"{"type":"ready","protocol":1,"provider":"p","model":"m","microphone":"x","voice":1}"#, .invalidValue(event: "ready", field: "voice")),
            (#"{"type":"reply"}"#, .missingField(event: "reply", field: "text")),
        ]
        for (line, expected) in cases {
            #expect(throws: expected, "\(line)") { try decodeEvent(line) }
        }
    }

    @Test func eventNamesNeverContainWhatWasSaid() throws {
        let secret = "my bank PIN is 1234"
        for event in [IslandEvent.transcript(secret), .reply(secret), .notice(kind: "no_speech", message: secret)] {
            #expect(!event.name.contains("1234"))
        }
    }
}

@Suite("LineBuffer")
struct LineBufferTests {
    @Test func joinsLinesSplitAcrossChunks() {
        var buffer = LineBuffer()
        #expect(buffer.append(Data("{\"type\":\"st".utf8)) == [])
        #expect(buffer.append(Data("ate\"}\n{\"a\":1}\n{\"b\"".utf8)) == [.line("{\"type\":\"state\"}"), .line("{\"a\":1}")])
        #expect(buffer.append(Data(":2}\r\n".utf8)) == [.line("{\"b\":2}")])
        #expect(buffer.finish() == [])
    }

    @Test func keepsMultiByteCharactersSplitAcrossChunks() {
        var buffer = LineBuffer()
        let bytes = Array("Kathmandu → काठमाडौं\n".utf8)
        var items: [LineBuffer.Item] = []
        for byte in bytes { items += buffer.append(Data([byte])) } // worst case: one byte at a time
        #expect(items == [.line("Kathmandu → काठमाडौं")])
    }

    @Test func returnsUnterminatedTextAtEnd() {
        var buffer = LineBuffer()
        _ = buffer.append(Data("{\"type\":\"quit\"}".utf8))
        #expect(buffer.finish() == [.line("{\"type\":\"quit\"}")])
        #expect(buffer.finish() == [])
    }

    @Test func dropsOverlongLinesAndRecovers() {
        var buffer = LineBuffer(maxLineBytes: 10)
        #expect(buffer.append(Data("0123456789ABC".utf8)) == [.overlong]) // reported as soon as it is too long
        #expect(buffer.append(Data("DEF\nok\n".utf8)) == [.line("ok")]) // rest of that line is skipped
        #expect(buffer.append(Data("0123456789ABCDEF\nok2\n".utf8)) == [.overlong, .line("ok2")])
    }
}

@Suite("RestartPolicy")
struct RestartPolicyTests {
    @Test func backsOffOnQuickFailures() {
        var policy = RestartPolicy(delays: [1, 2, 4], stableAfter: 30, maxConsecutiveFailures: 5)
        let decisions = (0..<6).map { _ in policy.decide(exitCode: 1, uptime: 0.5, requested: false) }
        #expect(decisions == [.restart(after: 1), .restart(after: 2), .restart(after: 4), .restart(after: 4), .restart(after: 4), .giveUp])
    }

    @Test func aStableRunStartsTheDelaysOver() {
        var policy = RestartPolicy(delays: [1, 2, 4], stableAfter: 30)
        _ = policy.decide(exitCode: 1, uptime: 1, requested: false)
        _ = policy.decide(exitCode: 1, uptime: 1, requested: false)
        #expect(policy.decide(exitCode: 1, uptime: 3600, requested: false) == .restart(after: 1))
    }

    @Test func configErrorsAreNotRestarted() {
        var policy = RestartPolicy()
        #expect(policy.decide(exitCode: 78, uptime: 0.2, requested: false) == .configError)
    }

    @Test func requestedStopsStayStopped() {
        var policy = RestartPolicy()
        #expect(policy.decide(exitCode: 0, uptime: 5, requested: true) == .stay)
        #expect(policy.decide(exitCode: 137, uptime: 5, requested: true) == .stay) // killed after a timeout
        #expect(policy.consecutiveFailures == 0)
    }

    @Test func anUnrequestedCleanExitIsRestarted() {
        var policy = RestartPolicy(delays: [1])
        #expect(policy.decide(exitCode: 0, uptime: 100, requested: false) == .restart(after: 1))
    }

    @Test func resetForgetsFailures() {
        var policy = RestartPolicy(delays: [1, 2], maxConsecutiveFailures: 1)
        _ = policy.decide(exitCode: 1, uptime: 0, requested: false)
        #expect(policy.decide(exitCode: 1, uptime: 0, requested: false) == .giveUp)
        policy.reset()
        #expect(policy.decide(exitCode: 1, uptime: 0, requested: false) == .restart(after: 1))
    }
}

@Suite("RuntimeLocator")
struct RuntimeLocatorTests {
    let entry = "/p/zeno/apps/mac/src/main.ts"

    func locator(
        env: [String: String] = [:],
        info: [String: String] = ["ZenoProjectRoot": "/p/zeno"],
        nodes: [String: String] = ["/opt/homebrew/bin/node": "v26.10.0"],
        files: Set<String>? = nil
    ) -> RuntimeLocator {
        let files = files ?? [entry]
        return RuntimeLocator(
            environment: env,
            bundleInfo: info,
            homeDirectory: "/Users/k",
            isExecutable: { nodes[$0] != nil },
            fileExists: { files.contains($0) },
            nodeVersion: { nodes[$0] })
    }

    @Test func buildsTheLaunchCommand() throws {
        let launch = try locator(env: ["PATH": "/usr/bin:/bin", "HOME": "/Users/k"]).locate()
        #expect(launch.executable.path == "/opt/homebrew/bin/node")
        #expect(launch.arguments == ["--env-file-if-exists=.env", "apps/mac/src/main.ts", "--island"])
        #expect(launch.directory.path == "/p/zeno")
        #expect(launch.environment["HOME"] == "/Users/k")
        // ffmpeg and whisper-cli are found by name, so their folders must be on PATH even when started from Finder.
        #expect(launch.environment["PATH"] == "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
    }

    @Test func environmentOverridesTheBuiltInSettings() throws {
        let launch = try locator(
            env: ["ZENO_PROJECT_ROOT": "/elsewhere", "ZENO_NODE": "/custom/node"],
            nodes: ["/custom/node": "v22.23.0", "/opt/homebrew/bin/node": "v26.10.0"],
            files: ["/elsewhere/apps/mac/src/main.ts", entry]
        ).locate()
        #expect(launch.directory.path == "/elsewhere")
        #expect(launch.executable.path == "/custom/node")
        #expect(launch.environment["PATH"]?.hasPrefix("/custom:") == true)
    }

    @Test func aFolderWithoutZENOIsSkipped() throws {
        let launch = try locator(env: ["ZENO_PROJECT_ROOT": "/stale"]).locate()
        #expect(launch.directory.path == "/p/zeno")
    }

    @Test func reportsAMissingProject() {
        #expect(throws: LocateError.projectNotFound(tried: ["/p/zeno"])) { try locator(files: []).locate() }
    }

    @Test func skipsNodeThatIsTooOld() throws {
        let launch = try locator(nodes: ["/opt/homebrew/bin/node": "v20.11.1", "/Users/k/.local/bin/node": "v22.23.0"]).locate()
        #expect(launch.executable.path == "/Users/k/.local/bin/node")
    }

    @Test func explainsWhenOnlyAnOldNodeExists() {
        #expect(throws: LocateError.nodeTooOld(path: "/opt/homebrew/bin/node", version: "v22.11.0")) {
            try locator(nodes: ["/opt/homebrew/bin/node": "v22.11.0"]).locate()
        }
    }

    @Test func explainsWhenNoNodeExists() throws {
        do {
            _ = try locator(nodes: [:]).locate()
            Issue.record("expected an error")
        } catch let error as LocateError {
            guard case .nodeNotFound(let tried) = error else { Issue.record("wrong error \(error)"); return }
            #expect(tried.contains("/opt/homebrew/bin/node"))
            #expect(error.description.contains("brew install node"))
        }
    }

    @Test func parsesNodeVersions() {
        #expect(NodeVersion(parsing: "v22.18.0\n") == NodeVersion(22, 18, 0))
        #expect(NodeVersion(parsing: "v26.10.0-nightly2026") == NodeVersion(26, 10, 0))
        #expect(NodeVersion(parsing: "nonsense") == nil)
        #expect(NodeVersion(22, 17, 9) < RuntimeLocator.minimumNode)
        #expect(!(NodeVersion(22, 18, 0) < RuntimeLocator.minimumNode))
    }
}
