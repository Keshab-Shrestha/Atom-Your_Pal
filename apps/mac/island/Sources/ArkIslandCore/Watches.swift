import Foundation

// Watch for me (2026-11-04): pages ARK reads on a timer with no model, and tells the user once when they change. The runtime keeps
// them (at most 10); this holds what the window shows. Never page text: the URL, the user's phrase and a short status.

public struct WatchItem: Sendable, Equatable, Identifiable {
    public var id: String
    public var url: String
    /// change, contains or missing.
    public var mode: String
    public var text: String?
    public var everyMinutes: Int
    /// watching, fired or stopped.
    public var state: String
    public var message: String?
    public var lastCheckAt: Date?

    public init(id: String, url: String, mode: String, text: String? = nil, everyMinutes: Int, state: String, message: String? = nil, lastCheckAt: Date? = nil) {
        self.id = id; self.url = url; self.mode = mode; self.text = text; self.everyMinutes = everyMinutes
        self.state = state; self.message = message; self.lastCheckAt = lastCheckAt
    }

    public var host: String { URL(string: url)?.host ?? url }
    public var isWatching: Bool { state == "watching" }

    /// "until it changes", "until it shows “slots open”", "until “slots open” is gone".
    public var condition: String {
        switch mode {
        case "contains": "until it shows “\(text ?? "")”"
        case "missing": "until “\(text ?? "")” is gone"
        default: "until it changes"
        }
    }

    /// "every 30 minutes", "every hour", "every 24 hours".
    public var interval: String {
        if everyMinutes == 60 { return "every hour" }
        if everyMinutes % 60 == 0 { return "every \(everyMinutes / 60) hours" }
        return "every \(everyMinutes) minutes"
    }

    private static func date(_ string: String) -> Date? {
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: string) ?? plain.date(from: string)
    }

    /// A malformed entry is left out.
    public static func list(from value: Any?) -> [WatchItem] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let w = entry as? [String: Any], let id = w["id"] as? String, let url = w["url"] as? String, let mode = w["mode"] as? String,
                  let state = w["state"] as? String, let every = w["everyMinutes"] as? Int else { return nil }
            let checked = (w["lastCheckAt"] as? String).flatMap(Self.date)
            return WatchItem(id: id, url: url, mode: mode, text: w["text"] as? String, everyMinutes: every, state: state, message: w["message"] as? String, lastCheckAt: checked)
        }
    }
}

/// A watch fired (the condition held) or stopped on its own (the page kept failing).
public struct WatchNotice: Sendable, Equatable {
    public var id: String
    public var stopped: Bool
    public var message: String

    public init(id: String, stopped: Bool, message: String) {
        self.id = id; self.stopped = stopped; self.message = message
    }
}
