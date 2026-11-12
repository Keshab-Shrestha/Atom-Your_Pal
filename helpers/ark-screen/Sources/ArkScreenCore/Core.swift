import Foundation

/// One request line: `{"id":1,"cmd":"screenshot","path":"/tmp/a.png"}`.
public struct Request: Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case size
        case screenshot(path: String)
        case tree(pid: Int?, depth: Int, max: Int)
        case marker(x: Double, y: Double, seconds: Double)
    }
    public let id: Int
    public let kind: Kind

    public static let maxDepth = 12
    public static let maxNodes = 500

    /// Nil when the line is not a request. `error` explains a request that names a known command badly.
    public static func parse(_ line: String) -> (Request?, error: String?) {
        guard let data = line.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = o["id"] as? Int, let cmd = o["cmd"] as? String
        else { return (nil, nil) }
        func number(_ key: String) -> Double? { (o[key] as? NSNumber)?.doubleValue }
        switch cmd {
        case "size":
            return (Request(id: id, kind: .size), nil)
        case "screenshot":
            guard let path = o["path"] as? String, path.hasPrefix("/") else { return (nil, "\"screenshot\" needs an absolute \"path\".") }
            return (Request(id: id, kind: .screenshot(path: path)), nil)
        case "tree":
            let depth = min(max(Int(number("depth") ?? 6), 1), maxDepth)
            let count = min(max(Int(number("max") ?? 200), 1), maxNodes)
            return (Request(id: id, kind: .tree(pid: (o["pid"] as? Int), depth: depth, max: count)), nil)
        case "marker":
            guard let x = number("x"), let y = number("y"), x.isFinite, y.isFinite else { return (nil, "\"marker\" needs \"x\" and \"y\".") }
            return (Request(id: id, kind: .marker(x: x, y: y, seconds: min(max(number("seconds") ?? 3, 0.2), 30))), nil)
        default:
            return (nil, "\"\(cmd)\" is not a command.")
        }
    }
}

/// One Accessibility element.
public struct Node: Equatable, Sendable {
    public let depth: Int
    public let role: String
    public let title: String
    public let x: Double, y: Double, width: Double, height: Double
    public init(depth: Int, role: String, title: String, x: Double, y: Double, width: Double, height: Double) {
        self.depth = depth; self.role = role; self.title = title; self.x = x; self.y = y; self.width = width; self.height = height
    }
}

/// The screen. The real one uses ScreenCaptureKit, the Accessibility API and a window; the tests use a fake.
public protocol ScreenSystem: Sendable {
    func size() -> (width: Double, height: Double)
    /// Writes a PNG of the main display to `path`. Returns its size in pixels.
    func screenshot(to path: String) async throws -> (width: Int, height: Int)
    func tree(pid: Int?, depth: Int, max: Int) throws -> [Node]
    func marker(x: Double, y: Double, seconds: Double) async
}

public enum Wire {
    /// The tree as text, one element a line: `  button "Save" (10,20 80x24)`.
    public static func text(_ nodes: [Node]) -> String {
        nodes.map { n in
            let title = n.title.isEmpty ? "" : " \"\(n.title.replacingOccurrences(of: "\n", with: " "))\""
            return String(repeating: "  ", count: n.depth) + n.role + title + " (\(Int(n.x)),\(Int(n.y)) \(Int(n.width))x\(Int(n.height)))"
        }.joined(separator: "\n")
    }

    static func line(_ object: [String: Any]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{\"ok\":false}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    public static func failure(id: Int, _ message: String) -> String { line(["id": id, "ok": false, "error": message]) }

    /// The reply line to one request.
    public static func respond(to request: Request, using system: ScreenSystem) async -> String {
        let id = request.id
        switch request.kind {
        case .size:
            let s = system.size()
            return line(["id": id, "ok": true, "width": s.width, "height": s.height])
        case .screenshot(let path):
            do {
                let s = try await system.screenshot(to: path)
                return line(["id": id, "ok": true, "path": path, "width": s.width, "height": s.height])
            } catch { return failure(id: id, "\(error)") }
        case .tree(let pid, let depth, let max):
            do {
                let nodes = try system.tree(pid: pid, depth: depth, max: max)
                return line(["id": id, "ok": true, "count": nodes.count, "text": text(nodes)])
            } catch { return failure(id: id, "\(error)") }
        case .marker(let x, let y, let seconds):
            await system.marker(x: x, y: y, seconds: seconds)
            return line(["id": id, "ok": true])
        }
    }
}
