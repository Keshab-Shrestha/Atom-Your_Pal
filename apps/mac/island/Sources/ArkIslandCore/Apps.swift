import Foundation

// Apps (2026-11-05, Keshab: "everything is a plugin where I can create and run new apps within ARK"; the runtime's ark-apps.ts).
// An app is one HTML page the agent wrote and the user approved. The window runs it in a locked-down web view: nothing leaves the page
// except calls to the bridge below, and the runtime checks every call again. This file holds the plain parts, so they are unit-tested:
// what the window lists, the page wrapper (the policy that blocks the network) and the check of a call from the page.

/// One app in the list. Never its code.
public struct AppItem: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var description: String
    /// The user allowed this app to ask ARK questions.
    public var ask: Bool
    public var version: Int

    public init(id: String, name: String, description: String, ask: Bool, version: Int) {
        self.id = id; self.name = name; self.description = description; self.ask = ask; self.version = version
    }

    /// A malformed entry is left out.
    public static func list(from value: Any?) -> [AppItem] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let a = entry as? [String: Any], let id = a["id"] as? String, let name = a["name"] as? String else { return nil }
            return AppItem(id: id, name: name, description: a["description"] as? String ?? "", ask: a["ask"] as? Bool ?? false, version: a["version"] as? Int ?? 1)
        }
    }
}

/// An app's page, sent when the user opens it.
public struct AppOpened: Sendable, Equatable {
    public var id: String
    public var name: String
    public var html: String
    public var ask: Bool
    /// Why there is no page ("This app was removed.").
    public var problem: String?

    public init(id: String, name: String, html: String, ask: Bool, problem: String? = nil) {
        self.id = id; self.name = name; self.html = html; self.ask = ask; self.problem = problem
    }
}

/// The runtime's answer to one bridge call. `valueJSON` is the value as JSON text ("null", "\"text\"", "[\"a\"]").
public struct AppReply: Sendable, Equatable {
    public var app: String
    public var req: String
    public var ok: Bool
    public var valueJSON: String
    public var error: String?

    public init(app: String, req: String, ok: Bool, valueJSON: String = "null", error: String? = nil) {
        self.app = app; self.req = req; self.ok = ok; self.valueJSON = valueJSON; self.error = error
    }

    /// The script that hands this answer to the page's waiting promise. Every piece is JSON text, so nothing in a value can end the call early.
    public var script: String {
        let error = self.error.flatMap { try? JSONSerialization.data(withJSONObject: [$0], options: []) }.flatMap { String(data: $0, encoding: .utf8) }
        let errorJSON = error.map { String($0.dropFirst().dropLast()) } ?? "null"
        let reqJSON = (try? JSONSerialization.data(withJSONObject: [req], options: [])).flatMap { String(data: $0, encoding: .utf8) }.map { String($0.dropFirst().dropLast()) } ?? "\"\""
        return "window.__arkReply(\(reqJSON), \(ok), \(valueJSON), \(errorJSON));"
    }
}

/// One call from a page, checked.
public struct AppCall: Sendable, Equatable {
    public var req: String
    public var op: String
    public var key: String?
    public var value: String?
    public var prompt: String?
}

public enum AppBridge {
    public static let operations: Set<String> = ["storage.get", "storage.set", "storage.remove", "storage.list", "ask"]
    public static let maxKey = 100
    public static let maxValue = 16_000
    public static let maxPrompt = 2_000

    /// What the page may load or do: its own inline code and `data:` images, nothing else. No network, no frames, no forms, no `<base>`.
    public static let policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'"

    /// The page, with the policy first so nothing in the app's own HTML comes before it.
    public static func page(html: String) -> String {
        "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"\(policy)\">" + html
    }

    /// Runs before the page's own code. `window.ark` is frozen; each call waits for the answer for at most 30 seconds.
    public static let script = """
    (function () {
      var pending = {}, count = 0;
      function call(op, args) {
        return new Promise(function (resolve, reject) {
          var req = 'r' + (++count) + '_' + Math.random().toString(36).slice(2, 8);
          pending[req] = { resolve: resolve, reject: reject };
          window.webkit.messageHandlers.ark.postMessage(Object.assign({ req: req, op: op }, args));
          setTimeout(function () { if (pending[req]) { delete pending[req]; reject(new Error('ARK did not answer in time.')); } }, 30000);
        });
      }
      Object.defineProperty(window, '__arkReply', { value: function (req, ok, value, error) {
        var p = pending[req]; if (!p) return; delete pending[req];
        if (ok) p.resolve(value); else p.reject(new Error(error || 'The call failed.'));
      } });
      Object.defineProperty(window, 'ark', { enumerable: true, value: Object.freeze({
        storage: Object.freeze({
          get: function (key) { return call('storage.get', { key: String(key) }); },
          set: function (key, value) { return call('storage.set', { key: String(key), value: String(value) }); },
          remove: function (key) { return call('storage.remove', { key: String(key) }); },
          list: function () { return call('storage.list', {}); }
        }),
        ask: function (question) { return call('ask', { prompt: String(question) }); }
      }) });
    })();
    """

    /// A message from the page, or nil when it is not a well-formed call: an unknown operation, a wrong type, or a size over the limit.
    public static func parse(_ body: Any) -> AppCall? {
        guard let m = body as? [String: Any], let req = m["req"] as? String, let op = m["op"] as? String, operations.contains(op),
              !req.isEmpty, req.count <= 40, req.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }) else { return nil }
        func text(_ name: String, _ limit: Int) -> String?? {
            guard let raw = m[name] else { return .some(nil) }
            guard let s = raw as? String, s.count <= limit else { return nil }
            return .some(s)
        }
        guard let key = text("key", maxKey), let value = text("value", maxValue), let prompt = text("prompt", maxPrompt) else { return nil }
        return AppCall(req: req, op: op, key: key, value: value, prompt: prompt)
    }
}
