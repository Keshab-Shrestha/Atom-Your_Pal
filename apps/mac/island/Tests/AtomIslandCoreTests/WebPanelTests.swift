import Foundation
import Testing
@testable import AtomIslandCore

/// The web panel contract (ADR-211, docs/web-panel-contract.md): what a panel may send, where it may navigate, and
/// what the host sends it.
struct WebPanelMessageTests {
    private let allowed: Set<String> = ["selectCall"]

    @Test func readyNamesThePanel() throws {
        let message: [String: Any] = ["v": 1, "type": "ready", "panel": "run"]
        #expect(try WebPanelMessage.parse(message, allowedIntents: allowed) == .ready(panel: "run"))
    }

    @Test func resizeKeepsAHeightFromZeroTo4000() throws {
        #expect(try WebPanelMessage.parse(["v": 1, "type": "resize", "height": 320.5], allowedIntents: allowed) == .resize(height: 320.5))
        #expect(try WebPanelMessage.parse(["v": 1, "type": "resize", "height": 0], allowedIntents: allowed) == .resize(height: 0))
        #expect(try WebPanelMessage.parse(["v": 1, "type": "resize", "height": 4000], allowedIntents: allowed) == .resize(height: 4000))
        #expect(throws: WebPanelError.badField("height")) { try WebPanelMessage.parse(["v": 1, "type": "resize", "height": 4001], allowedIntents: allowed) }
        #expect(throws: WebPanelError.badField("height")) { try WebPanelMessage.parse(["v": 1, "type": "resize", "height": -1], allowedIntents: allowed) }
        #expect(throws: WebPanelError.badField("height")) { try WebPanelMessage.parse(["v": 1, "type": "resize", "height": Double.nan], allowedIntents: allowed) }
        #expect(throws: WebPanelError.badField("height")) { try WebPanelMessage.parse(["v": 1, "type": "resize", "height": "300"], allowedIntents: allowed) }
        #expect(throws: WebPanelError.badField("height")) { try WebPanelMessage.parse(["v": 1, "type": "resize", "height": true], allowedIntents: allowed) }
    }

    @Test func anIntentNeedsAnAllowedNameAndIdArguments() throws {
        let intent: [String: Any] = ["v": 1, "type": "intent", "name": "selectCall", "args": ["id": "call_7:a.b-c"]]
        #expect(try WebPanelMessage.parse(intent, allowedIntents: allowed) == .intent(name: "selectCall", args: ["id": "call_7:a.b-c"]))
        #expect(throws: WebPanelError.intentNotAllowed("deleteChat")) {
            try WebPanelMessage.parse(["v": 1, "type": "intent", "name": "deleteChat", "args": [String: String]()], allowedIntents: allowed)
        }
        #expect(throws: WebPanelError.badField("args")) {
            try WebPanelMessage.parse(["v": 1, "type": "intent", "name": "selectCall", "args": ["id": "has space"]], allowedIntents: allowed)
        }
        #expect(throws: WebPanelError.badField("args")) {
            try WebPanelMessage.parse(["v": 1, "type": "intent", "name": "selectCall", "args": ["id": String(repeating: "a", count: 129)]], allowedIntents: allowed)
        }
        #expect(throws: WebPanelError.badField("args")) {
            try WebPanelMessage.parse(["v": 1, "type": "intent", "name": "selectCall", "args": ["id": 7]], allowedIntents: allowed)
        }
        #expect(throws: WebPanelError.badField("args")) {
            try WebPanelMessage.parse(["v": 1, "type": "intent", "name": "selectCall"], allowedIntents: allowed)
        }
    }

    @Test func aMessageWithTheWrongVersionOrTypeIsRefused() {
        #expect(throws: WebPanelError.badVersion) { try WebPanelMessage.parse(["v": 2, "type": "ready", "panel": "run"], allowedIntents: allowed) }
        #expect(throws: WebPanelError.badVersion) { try WebPanelMessage.parse(["v": true, "type": "ready", "panel": "run"], allowedIntents: allowed) }
        #expect(throws: WebPanelError.badVersion) { try WebPanelMessage.parse(["type": "ready", "panel": "run"], allowedIntents: allowed) }
        #expect(throws: WebPanelError.unknownType) { try WebPanelMessage.parse(["v": 1, "type": "data", "panel": "run"], allowedIntents: allowed) }
        #expect(throws: WebPanelError.unknownType) { try WebPanelMessage.parse(["v": 1], allowedIntents: allowed) }
    }

    @Test func anUnknownFieldIsRefused() {
        #expect(throws: WebPanelError.unknownField("token")) { try WebPanelMessage.parse(["v": 1, "type": "ready", "panel": "run", "token": "x"], allowedIntents: allowed) }
        #expect(throws: WebPanelError.unknownField("panel")) { try WebPanelMessage.parse(["v": 1, "type": "resize", "height": 1, "panel": "run"], allowedIntents: allowed) }
    }

    @Test func aPanelNameIsLowercaseWithDashes() {
        #expect(throws: WebPanelError.badField("panel")) { try WebPanelMessage.parse(["v": 1, "type": "ready", "panel": "../run"], allowedIntents: allowed) }
        #expect(throws: WebPanelError.badField("panel")) { try WebPanelMessage.parse(["v": 1, "type": "ready", "panel": "Run"], allowedIntents: allowed) }
        #expect(throws: WebPanelError.badField("panel")) { try WebPanelMessage.parse(["v": 1, "type": "ready"], allowedIntents: allowed) }
    }

    @Test func aBodyThatIsNotAnObjectOrIsTooBigIsRefused() {
        #expect(throws: WebPanelError.notObject) { try WebPanelMessage.parse("ready", allowedIntents: allowed) }
        #expect(throws: WebPanelError.notObject) { try WebPanelMessage.parse([1, 2], allowedIntents: allowed) }
        let big: [String: Any] = ["v": 1, "type": "intent", "name": "selectCall", "args": ["id": "a"], "pad": String(repeating: "x", count: 17_000)]
        #expect(throws: WebPanelError.tooLarge) { try WebPanelMessage.parse(big, allowedIntents: allowed) }
    }
}

struct WebPanelNavigationTests {
    private let entry = URL(fileURLWithPath: "/App/ATOM.app/Contents/Resources/web/run/index.html")

    @Test func onlyTheEntryPageLoadsAndOnlyOnce() {
        var policy = WebPanelNavigationPolicy(entry: entry)
        let first = policy.allows(entry)
        let second = policy.allows(entry)
        #expect(first)
        #expect(!second, "a reload or a second navigation is cancelled")
    }

    @Test func anotherPageOrSchemeNeverLoads() {
        var policy = WebPanelNavigationPolicy(entry: entry)
        let refused = [
            policy.allows(nil),
            policy.allows(URL(string: "https://example.com/")),
            policy.allows(URL(fileURLWithPath: "/App/ATOM.app/Contents/Resources/web/run/other.html")),
            policy.allows(URL(fileURLWithPath: "/App/ATOM.app/Contents/Resources/web/run/../../secret.html")),
        ]
        let entryAfter = policy.allows(entry)
        #expect(refused == [false, false, false, false])
        #expect(entryAfter, "a refused request does not use up the first load")
    }

    @Test func theReadFolderIsThePanelFolder() {
        #expect(WebPanelNavigationPolicy(entry: entry).readAccess.path == "/App/ATOM.app/Contents/Resources/web/run")
    }
}

struct WebPanelHostTests {
    private func theme(_ palette: ThemePalette = AppTheme.daylight.palette, scale: CGFloat = 1, reduceMotion: Bool = false) -> WebPanelTheme {
        WebPanelTheme(palette: palette, textScale: scale, reduceMotion: reduceMotion)
    }

    @Test func aThemeCarriesTheSchemeAndTheElevenTokens() {
        let light = theme(AppTheme.daylight.palette)
        let dark = theme(AppTheme.void.palette)
        #expect(light.scheme == "light" && dark.scheme == "dark")
        let names: Set<String> = ["--bg", "--panel", "--text", "--muted", "--quiet", "--line", "--fill", "--accent", "--accent-text", "--green", "--blue"]
        #expect(Set(light.tokens.keys) == names)
        for value in Array(light.tokens.values) + Array(dark.tokens.values) {
            #expect(value.wholeMatch(of: /rgb\((\d{1,3}) (\d{1,3}) (\d{1,3})\)/) != nil, "every token is an opaque rgb() colour: \(value)")
        }
        #expect(light.tokens["--bg"] != dark.tokens["--bg"])
    }

    @Test func theTextScaleStaysBetween0_8And2() {
        #expect(theme(scale: 0.1).textScale == 0.8)
        #expect(theme(scale: 1.2).textScale == 1.2)
        #expect(theme(scale: 9).textScale == 2.0)
    }

    @Test func hostMessagesCarryTheVersionAndType() {
        let t = theme(reduceMotion: true)
        let hello = WebPanelHost.initMessage(panel: "run", theme: t)
        #expect(hello["v"] as? Int == 1 && hello["type"] as? String == "init" && hello["panel"] as? String == "run")
        #expect(hello["scheme"] as? String == "light" && hello["reduceMotion"] as? Bool == true && hello["textScale"] as? Double == 1.0)
        #expect((hello["tokens"] as? [String: String])?.count == 11)
        let restyle = WebPanelHost.themeMessage(t)
        #expect(restyle["type"] as? String == "theme" && restyle["panel"] == nil)
        let data = WebPanelHost.dataMessage(revision: 4, payload: ["state": "working"])
        #expect(data["type"] as? String == "data" && data["revision"] as? Int == 4 && (data["payload"] as? [String: Any])?["state"] as? String == "working")
        #expect(WebPanelHost.resetMessage()["type"] as? String == "reset")
        for message in [hello, restyle, data, WebPanelHost.resetMessage()] {
            #expect(JSONSerialization.isValidJSONObject(message), "every host message can cross to the page as JSON")
        }
    }
}

struct RunPanelPayloadTests {
    private func snapshot(calls: Int = 2, omitted: Int = 0, tool: String = "read_file", questions: String = "[]") throws -> ChatWorkSnapshot {
        let items = (0..<calls).map { #"{"id":"call_\#($0)","tool":"\#(tool)","state":"done","ms":12.5}"# }.joined(separator: ",")
        let json = #"{"chat":"c1","turn":"t1","startedAt":"2026-10-28T09:00:00Z","elapsedMs":1500,"state":"working","calls":[\#(items)],"omitted":\#(omitted),"questions":\#(questions)}"#
        return try JSONDecoder().decode(ChatWorkSnapshot.self, from: Data(json.utf8))
    }

    @Test func theSnapshotBecomesThePayloadOfTheContract() throws {
        let payload = RunPanelPayload.make(try snapshot())
        #expect(payload["chat"] as? String == "c1" && payload["turn"] as? String == "t1" && payload["state"] as? String == "working")
        #expect(payload["elapsedMs"] as? Double == 1500 && payload["omitted"] as? Int == 0)
        let calls = payload["calls"] as? [[String: Any]]
        #expect(calls?.count == 2 && calls?.first?["id"] as? String == "call_0" && calls?.first?["ms"] as? Double == 12.5)
        #expect(payload["unavailable"] as? [String] == ["pipeline", "lanes", "evidence"])
        #expect(payload["startedAt"] == nil, "only the contract's fields are sent")
    }

    @Test func aCallWithoutATimeSendsNull() throws {
        let json = #"{"chat":"c","turn":"t","startedAt":"x","elapsedMs":0,"state":"working","calls":[{"id":"a","tool":"t","state":"running"}],"omitted":0,"questions":[]}"#
        let payload = RunPanelPayload.make(try JSONDecoder().decode(ChatWorkSnapshot.self, from: Data(json.utf8)))
        #expect((payload["calls"] as? [[String: Any]])?.first?["ms"] is NSNull)
    }

    @Test func questionsLeaveOutTheAnswerAndTheError() throws {
        let questions = #"[{"id":"q1","prompt":"Which folder?","choices":["a","b"],"state":"answered","answer":"my private note","error":"disk /Users/k"}]"#
        let payload = RunPanelPayload.make(try snapshot(questions: questions))
        let sent = (payload["questions"] as? [[String: Any]])?.first
        #expect(sent?["id"] as? String == "q1" && sent?["prompt"] as? String == "Which folder?" && sent?["state"] as? String == "answered")
        #expect(Set(sent?.keys.map { $0 } ?? []) == ["id", "prompt", "state"])
        let text = String(decoding: try JSONSerialization.data(withJSONObject: payload), as: UTF8.self)
        #expect(!text.contains("my private note") && !text.contains("/Users/k"))
    }

    @Test func stringsAreCutAt500Characters() throws {
        let payload = RunPanelPayload.make(try snapshot(calls: 1, tool: String(repeating: "t", count: 900)))
        #expect(((payload["calls"] as? [[String: Any]])?.first?["tool"] as? String)?.count == 500)
    }

    @Test func atMost200CallsGoAndTheRestAreCounted() throws {
        let payload = RunPanelPayload.make(try snapshot(calls: 230, omitted: 5, tool: "t"))
        #expect((payload["calls"] as? [[String: Any]])?.count == 200)
        #expect(payload["omitted"] as? Int == 35, "5 already left out by the runtime plus 30 more")
    }

    @Test func thePayloadStaysUnder256KiB() throws {
        let long = String(repeating: "x", count: 900)
        let items = (0..<200).map { #"{"id":"\#(long)\#($0)","tool":"\#(long)","state":"\#(long)","ms":1}"# }.joined(separator: ",")
        let json = #"{"chat":"c","turn":"t","startedAt":"x","elapsedMs":0,"state":"working","calls":[\#(items)],"omitted":0,"questions":[]}"#
        let payload = RunPanelPayload.make(try JSONDecoder().decode(ChatWorkSnapshot.self, from: Data(json.utf8)))
        let size = try JSONSerialization.data(withJSONObject: payload).count
        #expect(size <= 256 * 1024)
        let sent = (payload["calls"] as? [[String: Any]])?.count ?? 0
        #expect(sent > 0 && sent < 200 && (payload["omitted"] as? Int) == 200 - sent, "calls that do not fit are counted as omitted")
    }
}
