import Foundation

/// A line the app writes to the helper: `{"cmd":"start"}`, `{"cmd":"stop"}` or `{"cmd":"cancel"}`.
public enum Command: Equatable, Sendable {
    case start, stop, cancel

    /// Nil for a line that is not JSON or names no known command. The helper ignores such lines.
    public static func parse(_ line: String) -> Command? {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let name = object["cmd"] as? String
        else { return nil }
        switch name {
        case "start": return .start
        case "stop": return .stop
        case "cancel": return .cancel
        default: return nil
        }
    }
}

/// A line the helper writes to the app.
public enum Event: Equatable, Sendable {
    case ready
    case level(Double)
    case transcript(String)
    case error(String)

    /// One JSON object, no newline. Keys are sorted so the output is stable.
    public var line: String {
        let object: [String: Any]
        switch self {
        case .ready: object = ["type": "ready"]
        case .level(let peak): object = ["type": "level", "peak": min(max(peak, 0), 1)]
        case .transcript(let text): object = ["type": "transcript", "text": text]
        case .error(let message): object = ["type": "error", "message": message]
        }
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{\"type\":\"error\",\"message\":\"encode\"}".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}
