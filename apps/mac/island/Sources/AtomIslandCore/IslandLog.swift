import Foundation

/// Appends operational events to ZENO's log (`logs/zeno.log`), in the same JSON-lines format as the
/// runtime. Like the runtime, it records events and timings, never what was said or replied.
public final class IslandLog: @unchecked Sendable {
    public enum Level: String, Sendable { case info, warn, error }

    private let url: URL?
    private let queue = DispatchQueue(label: "zeno.island.log")
    private let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// - Parameter url: The log file; nil discards everything (tests).
    public init(url: URL?) {
        self.url = url
    }

    public func info(_ event: String, _ fields: [String: Any] = [:]) { write(.info, event, fields) }
    public func warn(_ event: String, _ fields: [String: Any] = [:]) { write(.warn, event, fields) }
    public func error(_ event: String, _ fields: [String: Any] = [:]) { write(.error, event, fields) }

    public func write(_ level: Level, _ event: String, _ fields: [String: Any]) {
        guard let url else { return }
        var entry: [String: Any] = ["time": formatter.string(from: Date()), "level": level.rawValue, "event": event]
        for (key, value) in fields { entry[key] = value }
        guard JSONSerialization.isValidJSONObject(entry),
              let json = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys, .withoutEscapingSlashes])
        else { return }
        let line = json + Data([0x0A])
        queue.async {
            // Logging must never take ZENO down: failures are ignored.
            let fm = FileManager.default
            try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !fm.fileExists(atPath: url.path) { fm.createFile(atPath: url.path, contents: nil) }
            guard let handle = try? FileHandle(forWritingTo: url) else { return }
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: line)
        }
    }

    /// Waits until queued lines are written (used before quitting, and by tests).
    public func flush() {
        queue.sync {}
    }
}
