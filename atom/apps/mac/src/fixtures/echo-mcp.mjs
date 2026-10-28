// A tiny MCP server for tests (ADR-090): one tool, "echo", over stdio.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "echo", version: "1.0.0" });
server.tool("echo", "Says hello.", async () => ({ content: [{ type: "text", text: "hello" }] }));
await server.connect(new StdioServerTransport());
