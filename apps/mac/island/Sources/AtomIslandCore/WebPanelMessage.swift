import Foundation

/// Why a message from a web panel was refused (ADR-211). The host drops the message and logs one line.
public enum WebPanelError: Error, Equatable, Sendable {
    case notObject, tooLarge, badVersion, unknownType
    case unknownField(String), badField(String), intentNotAllowed(String)
}

/// A checked message from a panel. A panel can only say it loaded, say how tall it is, or ask for an intent.
public enum WebPanelIncoming: Equatable, Sendable {
    case ready(panel: String)
    case resize(height: Double)
    case intent(name: String, args: [String: String])
}

/// The panel to host half of docs/web-panel-contract.md. A panel is not trusted: every message is checked here
/// before the app acts, and an intent is checked against the current state again by its handler.
public enum WebPanelMessage {
    public static let version = 1
    public static let maxBytes = 16 * 1024
    public static let maxHeight = 4000.0
    static let maxArgs = 8

    private static let fields: [String: Set<String>] = [
        "ready": ["v", "type", "panel"],
        "resize": ["v", "type", "height"],
        "intent": ["v", "type", "name", "args"],
    ]

    /// `body` is what the web view hands over. `allowedIntents` is the list of the panel that sent it.
    public static func parse(_ body: Any, allowedIntents: Set<String>) throws -> WebPanelIncoming {
        guard let object = body as? [String: Any] else { throw WebPanelError.notObject }
        if JSONSerialization.isValidJSONObject(object), let data = try? JSONSerialization.data(withJSONObject: object), data.count > maxBytes {
            throw WebPanelError.tooLarge
        }
        guard number(object["v"]) == Double(version) else { throw WebPanelError.badVersion }
        guard let type = object["type"] as? String, let allowed = fields[type] else { throw WebPanelError.unknownType }
        if let extra = object.keys.sorted().first(where: { !allowed.contains($0) }) { throw WebPanelError.unknownField(extra) }
        switch type {
        case "ready":
            guard let panel = object["panel"] as? String, isPanelName(panel) else { throw WebPanelError.badField("panel") }
            return .ready(panel: panel)
        case "resize":
            guard let height = number(object["height"]), height.isFinite, (0...maxHeight).contains(height) else { throw WebPanelError.badField("height") }
            return .resize(height: height)
        default:
            guard let name = object["name"] as? String else { throw WebPanelError.badField("name") }
            guard allowedIntents.contains(name) else { throw WebPanelError.intentNotAllowed(name) }
            guard let raw = object["args"] as? [String: Any], raw.count <= maxArgs else { throw WebPanelError.badField("args") }
            var args: [String: String] = [:]
            for (key, value) in raw {
                guard isArgName(key), let id = value as? String, isID(id) else { throw WebPanelError.badField("args") }
                args[key] = id
            }
            return .intent(name: name, args: args)
        }
    }

    /// A JSON number. A boolean is not a number here, although the web view bridges both to NSNumber.
    private static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n.doubleValue
    }

    /// The id of a call, a task or a chat: letters, digits and . _ : - only, 1 to 128 characters.
    static func isID(_ text: String) -> Bool { text.wholeMatch(of: /[A-Za-z0-9._:-]{1,128}/) != nil }
    public static func isPanelName(_ text: String) -> Bool { text.wholeMatch(of: /[a-z][a-z0-9-]{0,31}/) != nil }
    static func isArgName(_ text: String) -> Bool { text.wholeMatch(of: /[a-zA-Z][A-Za-z0-9]{0,31}/) != nil }
}

/// The page may load once and never navigate again; every later navigation is cancelled. It may read only its own folder.
public struct WebPanelNavigationPolicy: Sendable {
    public let entry: URL
    private var loaded = false

    public init(entry: URL) { self.entry = entry.standardizedFileURL }

    /// The folder the web view may read: the panel's own.
    public var readAccess: URL { entry.deletingLastPathComponent() }

    /// True once, for the entry page. A refused request does not use up the first load.
    public mutating func allows(_ url: URL?) -> Bool {
        guard !loaded, let url, url.isFileURL, url.standardizedFileURL == entry else { return false }
        loaded = true
        return true
    }
}
