import Foundation
import Testing
@testable import AtomIslandCore

/// 2026-10-15: Keshab pastes an MCP server the way Claude Desktop writes it.
@Suite("MCP config import")
struct McpConfigImportTests {
    static let desktop = #"""
    {
      "mcpServers": {
        "filesystem": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Documents"]
        },
        "github": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-github"],
          "env": { "GITHUB_TOKEN": "ghp_secret", "ORG": "acme" }
        }
      }
    }
    """#

    @Test func readsAClaudeDesktopFile() {
        let result = McpConfigImport.parse(Self.desktop)
        #expect(result.problems.isEmpty)
        #expect(result.entries.map(\.draft.name) == ["filesystem", "github"])
        let fs = result.entries[0].draft
        #expect(fs.kind == "command" && fs.command == "npx")
        #expect(fs.args == "-y\n@modelcontextprotocol/server-filesystem\n/Users/me/Documents", "one argument per line, as the form wants")
        let gh = result.entries[1]
        #expect(gh.draft.env == "GITHUB_TOKEN=ghp_secret\nORG=acme")
        #expect(gh.notes.contains { $0.contains("2 private values") })
        #expect(gh.summary == "npx -y @modelcontextprotocol/server-github")
        #expect(result.addable.count == 2)
    }

    @Test func readsAUrlServerWithHeadersAndSse() {
        let http = McpConfigImport.parse(#"{"mcpServers":{"remote":{"url":"https://example.com/mcp","headers":{"Authorization":"Bearer abc"}}}}"#)
        #expect(http.entries.first?.draft.kind == "url" && http.entries.first?.draft.url == "https://example.com/mcp")
        #expect(http.entries.first?.draft.transport == "http" && http.entries.first?.draft.headers == "Authorization: Bearer abc")
        let sse = McpConfigImport.parse(#"{"old":{"serverUrl":"https://example.com/sse","type":"sse"}}"#)
        #expect(sse.entries.first?.draft.transport == "sse" && sse.entries.first?.summary.hasSuffix("(SSE)") == true)
    }

    @Test func acceptsTheInnerMapOneEntryAndABareServer() {
        let inner = McpConfigImport.parse(#"{"notes":{"command":"/usr/local/bin/notes-mcp","args":["--stdio"]}}"#)
        #expect(inner.entries.map(\.draft.name) == ["notes"])
        // One entry copied without the outer braces.
        let entry = McpConfigImport.parse(#""notes": {"command": "notes-mcp"}"#)
        #expect(entry.entries.map(\.draft.name) == ["notes"] && entry.problems.isEmpty)
        // A bare server gets a name from its last plain argument.
        let bare = McpConfigImport.parse(#"{"command":"npx","args":["-y","some-server"]}"#)
        #expect(bare.entries.map(\.draft.name) == ["some-server"])
        let remote = McpConfigImport.parse(#"{"url":"https://mcp.example.com/v1"}"#)
        #expect(remote.entries.map(\.draft.name) == ["mcp-example-com"])
    }

    @Test func namesAreMadeSafeAndUnique() {
        #expect(McpConfigImport.safeName("Filesystem Server") == "filesystem-server")
        #expect(McpConfigImport.safeName("  --Weird__Name!! ") == "weird__name")
        #expect(McpConfigImport.safeName("!!!") == "server")
        #expect(McpConfigImport.safeName(String(repeating: "a", count: 50)).count == 32)
        let result = McpConfigImport.parse(#"{"mcpServers":{"My Tool":{"command":"a"},"my-tool":{"command":"b"}}}"#)
        #expect(result.entries.map(\.draft.name) == ["my-tool", "my-tool-2"], "two names that fold to one stay apart")
        #expect(result.entries[0].originalName == "My Tool" && result.entries[0].notes.contains("saved as \"my-tool\""))
    }

    @Test func skipsServersThatAreAlreadyAdded() {
        let result = McpConfigImport.parse(Self.desktop, existing: ["github"])
        #expect(result.entries.map(\.exists) == [false, true])
        #expect(result.addable.map(\.name) == ["filesystem"])
    }

    @Test func badInputGivesWordsNotACrash() {
        #expect(McpConfigImport.parse("").entries.isEmpty && McpConfigImport.parse("   ").problems.isEmpty)
        #expect(McpConfigImport.parse("this is not json").problems.first?.contains("not valid JSON") == true)
        let nothing = McpConfigImport.parse(#"{"mcpServers":{}}"#)
        #expect(nothing.entries.isEmpty && !nothing.problems.isEmpty)
        let partial = McpConfigImport.parse(#"{"mcpServers":{"ok":{"command":"x"},"bad":{"args":["y"]},"worse":"text"}}"#)
        #expect(partial.entries.map(\.draft.name) == ["ok"] && partial.problems.count == 2, "good servers still come through")
    }
}
