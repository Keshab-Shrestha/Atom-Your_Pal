import Foundation
import Testing
@testable import ArkIslandCore

@Suite("Apps")
struct AppsTests {
    @Test("the apps event reads each app; a malformed one is left out")
    func readsApps() {
        guard case .apps(let list)? = try? decodeEvent(#"{"type":"apps","apps":[{"id":"habit-tracker","name":"Habit tracker","description":"Tick a habit","ask":true,"version":2,"updatedAt":"2026-11-05T10:00:00.000Z"},{"name":"no id"}]}"#) else { Issue.record("not an apps event"); return }
        #expect(list == [AppItem(id: "habit-tracker", name: "Habit tracker", description: "Tick a habit", ask: true, version: 2)])
    }

    @Test("the opened page and a refusal both decode")
    func readsOpened() {
        guard case .appOpened(let page)? = try? decodeEvent(#"{"type":"appOpened","id":"a","name":"A","html":"<p>hi</p>","ask":false}"#) else { Issue.record("no page"); return }
        #expect(page == AppOpened(id: "a", name: "A", html: "<p>hi</p>", ask: false))
        guard case .appOpened(let gone)? = try? decodeEvent(#"{"type":"appOpened","id":"a","name":"","html":"","ask":false,"problem":"This app was removed."}"#) else { Issue.record("no refusal"); return }
        #expect(gone.problem == "This app was removed.")
    }

    @Test("a reply carries its value as JSON, and the script hands it to the right promise")
    func readsReply() {
        guard case .appReply(let r)? = try? decodeEvent(#"{"type":"appReply","app":"a","req":"r1_x","ok":true,"value":["k1","k2"]}"#) else { Issue.record("no reply"); return }
        #expect(r.ok && r.valueJSON == #"["k1","k2"]"#)
        #expect(r.script == #"window.__arkReply("r1_x", true, ["k1","k2"], null);"#)
        guard case .appReply(let bad)? = try? decodeEvent(#"{"type":"appReply","app":"a","req":"r2","ok":false,"error":"Not \"allowed\"."}"#) else { Issue.record("no reply"); return }
        #expect(!bad.ok)
        #expect(bad.script == #"window.__arkReply("r2", false, null, "Not \"allowed\".");"#)
    }

    @Test("a text value cannot end the script early")
    func quoting() {
        guard case .appReply(let r)? = try? decodeEvent(#"{"type":"appReply","app":"a","req":"r3","ok":true,"value":"x\");alert(1);(\""}"#) else { Issue.record("no reply"); return }
        #expect(r.script == #"window.__arkReply("r3", true, "x\");alert(1);(\"", null);"#)
    }

    @Test("a call from the page is checked: known operation, strings, sizes")
    func parsesCalls() {
        #expect(AppBridge.parse(["req": "r1_a", "op": "storage.set", "key": "k", "value": "v"]) == AppCall(req: "r1_a", op: "storage.set", key: "k", value: "v", prompt: nil))
        #expect(AppBridge.parse(["req": "r1", "op": "ask", "prompt": "hi"])?.prompt == "hi")
        #expect(AppBridge.parse(["req": "r1", "op": "shell.run"]) == nil)
        #expect(AppBridge.parse(["req": "r 1", "op": "storage.list"]) == nil)
        #expect(AppBridge.parse(["req": "r1", "op": "storage.get", "key": 5]) == nil)
        #expect(AppBridge.parse(["req": "r1", "op": "storage.get", "key": String(repeating: "k", count: 101)]) == nil)
        #expect(AppBridge.parse(["req": "r1", "op": "storage.set", "value": String(repeating: "v", count: 16_001)]) == nil)
        #expect(AppBridge.parse("not a dictionary") == nil)
    }

    @Test("the page starts with a policy that blocks the network, frames and forms")
    func pagePolicy() {
        let page = AppBridge.page(html: "<script>1</script>")
        #expect(page.hasPrefix("<!doctype html><meta http-equiv=\"Content-Security-Policy\""))
        for rule in ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"] { #expect(AppBridge.policy.contains(rule)) }
        #expect(!AppBridge.policy.contains("http"))
        #expect(page.hasSuffix("<script>1</script>"))
    }

    @Test("the bridge script freezes window.ark and offers only notes and ask")
    func scriptShape() {
        #expect(AppBridge.script.contains("Object.freeze"))
        for name in ["storage.get", "storage.set", "storage.remove", "storage.list", "'ask'"] { #expect(AppBridge.script.contains(name)) }
    }

    @Test("commands: apps.list, app.open, app.remove and app.call")
    func commands() {
        #expect(IslandCommand.appsList.line == #"{"type":"apps.list"}"# + "\n")
        #expect(IslandCommand.appOpen(id: "a").line.contains(#""id":"a""#))
        #expect(IslandCommand.appRemove(id: "a").line.contains(#""type":"app.remove""#))
        let call = IslandCommand.appCall(app: "a", call: AppCall(req: "r1", op: "storage.get", key: "k", value: nil, prompt: nil)).line
        #expect(call.contains(#""type":"app.call""#) && call.contains(#""app":"a""#) && call.contains(#""req":"r1""#) && call.contains(#""key":"k""#))
        #expect(!call.contains("value"))
    }
}
