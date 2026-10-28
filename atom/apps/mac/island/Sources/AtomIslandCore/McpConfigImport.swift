import Foundation

/// Reads an MCP server config in the format Claude Desktop uses (and most MCP clients copy):
///
///     { "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"],
///                                       "env": { "TOKEN": "…" } },
///                       "remote":     { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } } } }
///
/// Keshab may paste the whole file, only the `mcpServers` map, one `"name": { … }` entry, or one bare server object. Each
/// server becomes a draft for the same add command as the by-hand form, so it is saved switched off and checked by the
/// runtime. Nothing here talks to a server or runs a command.
public struct McpConfigImport: Sendable, Equatable {
    public struct Entry: Sendable, Equatable, Identifiable {
        public var id: String { draft.name }
        public var draft: McpServerDraft
        /// The name in the pasted text, which may be changed to fit (lower case, letters, digits, "-" and "_").
        public var originalName: String
        /// What it runs or where it connects, in one line.
        public var summary: String
        /// Things worth saying: renamed, private values kept, already added.
        public var notes: [String]
        /// A server of this name is already added; it is not added again.
        public var exists: Bool
    }

    public var entries: [Entry]
    public var problems: [String]

    public init(entries: [Entry] = [], problems: [String] = []) {
        self.entries = entries
        self.problems = problems
    }

    /// The drafts to add: every server that is not already there.
    public var addable: [McpServerDraft] { entries.filter { !$0.exists }.map(\.draft) }

    /// Where Claude Desktop keeps its config on a Mac.
    public static var claudeDesktopConfigPath: String { "~/Library/Application Support/Claude/claude_desktop_config.json" }

    /// A server name the runtime accepts: lower case, digits, "-" and "_", starting with a letter or digit, at most 32.
    public static func safeName(_ raw: String) -> String {
        var out = ""
        for scalar in raw.lowercased().unicodeScalars {
            let ok = (scalar >= "a" && scalar <= "z") || (scalar >= "0" && scalar <= "9") || scalar == "-" || scalar == "_"
            let next = ok ? String(scalar) : "-"
            if next == "-", out.hasSuffix("-") { continue }
            out += next
        }
        out = String(out.drop { $0 == "-" || $0 == "_" })
        out = String(out.prefix(32))
        while out.hasSuffix("-") || out.hasSuffix("_") { out.removeLast() }
        return out.isEmpty ? "server" : out
    }

    /// `existing`: the names of the servers already added.
    public static func parse(_ text: String, existing: Set<String> = []) -> McpConfigImport {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return McpConfigImport() }
        guard let root = object(trimmed) ?? object("{" + trimmed + "}") else {
            return McpConfigImport(problems: ["That is not valid JSON. Paste the server from Claude Desktop's config, with its braces and quotes."])
        }
        let map: [String: Any]
        if let servers = root["mcpServers"] as? [String: Any] ?? root["servers"] as? [String: Any] {
            map = servers
        } else if root["command"] != nil || root["url"] != nil || root["serverUrl"] != nil {
            map = [derivedName(root): root] // one bare server
        } else {
            map = root
        }
        var result = McpConfigImport()
        var taken = Set<String>()
        for key in map.keys.sorted() {
            guard let server = map[key] as? [String: Any] else {
                result.problems.append("\"\(key)\": a server is an object with a \"command\" or a \"url\".")
                continue
            }
            guard var draft = draft(from: server) else {
                result.problems.append("\"\(key)\": needs a \"command\" (to run) or a \"url\" (to connect to).")
                continue
            }
            let base = safeName(key)
            var name = base
            var n = 2
            while taken.contains(name) { name = String(base.prefix(29)) + "-\(n)"; n += 1 }
            taken.insert(name)
            draft.name = name
            var notes = [String]()
            if name != key { notes.append("saved as \"\(name)\"") }
            let secrets = ((server["env"] as? [String: Any])?.count ?? 0) + ((server["headers"] as? [String: Any])?.count ?? 0)
            if secrets > 0 { notes.append("\(secrets) private value\(secrets == 1 ? "" : "s") kept on this Mac") }
            let exists = existing.contains(name)
            if exists { notes.append("already added, so it is skipped") }
            result.entries.append(Entry(draft: draft, originalName: key, summary: summary(of: draft), notes: notes, exists: exists))
        }
        if result.entries.isEmpty && result.problems.isEmpty { result.problems.append("No server found in that text.") }
        return result
    }

    private static func object(_ text: String) -> [String: Any]? {
        guard let data = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// A name for a bare server: its last argument that is not a flag or a path, else its command or address host.
    private static func derivedName(_ server: [String: Any]) -> String {
        let args = (server["args"] as? [Any])?.compactMap { $0 as? String } ?? []
        let candidate = args.last { !$0.hasPrefix("-") && !$0.contains("/") } ?? (server["command"] as? String) ?? (server["url"] as? String) ?? "server"
        return URL(string: candidate)?.host ?? candidate
    }

    private static func draft(from server: [String: Any]) -> McpServerDraft? {
        var draft = McpServerDraft()
        if let command = server["command"] as? String, !command.trimmingCharacters(in: .whitespaces).isEmpty {
            draft.kind = "command"
            draft.command = command.trimmingCharacters(in: .whitespaces)
            draft.args = (server["args"] as? [Any] ?? []).map { "\($0)" }.joined(separator: "\n")
            draft.env = (server["env"] as? [String: Any] ?? [:]).sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "\n")
            return draft
        }
        let address = (server["url"] as? String) ?? (server["serverUrl"] as? String)
        if let address, !address.trimmingCharacters(in: .whitespaces).isEmpty {
            draft.kind = "url"
            draft.url = address.trimmingCharacters(in: .whitespaces)
            draft.transport = ((server["type"] as? String) ?? (server["transport"] as? String))?.lowercased() == "sse" ? "sse" : "http"
            draft.headers = (server["headers"] as? [String: Any] ?? [:]).sorted { $0.key < $1.key }.map { "\($0.key): \($0.value)" }.joined(separator: "\n")
            return draft
        }
        return nil
    }

    private static func summary(of draft: McpServerDraft) -> String {
        let line = draft.kind == "command"
            ? ([draft.command] + draft.args.split(separator: "\n").map(String.init)).joined(separator: " ")
            : draft.url + (draft.transport == "sse" ? " (SSE)" : "")
        return line.count > 90 ? String(line.prefix(89)) + "…" : line
    }
}
