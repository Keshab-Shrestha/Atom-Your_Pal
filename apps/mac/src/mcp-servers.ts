// ADR-090: Keshab's MCP servers at run time: their Agent SDK configs, a test (the MCP handshake and the tool list),
// and the check each tool call passes: a trusted server's tools run; any other asks on Pal's card (no answer is a no).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServer } from "@atom/helpers";

export const MCP_TEST_TIMEOUT_MS = 15_000;

/** The server as the Agent SDK takes it. */
export function sdkConfig(server: McpServer): Record<string, unknown> {
  if (server.kind === "command") return { type: "stdio", command: server.command, args: server.args, env: server.env };
  return { type: server.transport, url: server.url, headers: server.headers };
}

/** Starts (or connects to) the server, completes the MCP handshake and lists its tools. Never throws. */
export async function testMcpServer(server: McpServer, timeoutMs = MCP_TEST_TIMEOUT_MS): Promise<{ tools: string[] } | { problem: string }> {
  const client = new Client({ name: "atom", version: "1.0.0" });
  const transport =
    server.kind === "command"
      ? new StdioClientTransport({ command: server.command!, args: server.args, env: { ...getDefaultEnvironment(), ...server.env }, stderr: "ignore" })
      : server.transport === "sse"
        ? new SSEClientTransport(new URL(server.url!), { requestInit: { headers: server.headers } })
        : new StreamableHTTPClientTransport(new URL(server.url!), { requestInit: { headers: server.headers } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const listed = await Promise.race([
      (async () => {
        await client.connect(transport);
        return (await client.listTools()).tools.map((t) => t.name);
      })(),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs / 1000} s`)), timeoutMs))),
    ]);
    return { tools: listed };
  } catch (error) {
    // Words for Keshab, without the server's own output (it may echo secrets).
    const message = error instanceof Error ? error.message : String(error);
    return { problem: `The server did not answer as an MCP server: ${message.split("\n")[0]!.slice(0, 160)}` };
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

export interface McpCheckOptions {
  servers: McpServer[];
  worker: string;
  approve(request: { summary: string; reason: string }): Promise<boolean>;
  /** Host adapters may require a fresh card after reading untrusted external content. */
  forceApproval?: boolean;
  /** Host-owned explanation/argument preview, never a server-supplied instruction. */
  reason?: string;
  /** For the log: the server and the verdict, never the input. */
  onCheck?(event: { server: string; verdict: "trusted" | "allowed" | "declined" }): void;
}

/** The check every MCP tool call of a run passes. */
export function mcpCheck(options: McpCheckOptions) {
  return async (tool: string): Promise<string | undefined> => {
    const parts = tool.split("__");
    const name = parts[1] ?? "";
    const toolName = parts.length > 2 ? parts.slice(2).join("__") : tool; // a tool named "do__thing" shows as "do__thing" on the card, not "do"
    const server = options.servers.find((s) => s.name === name);
    if (!server) return "That server is not one of this worker's.";
    if (server.trusted && !options.forceApproval) return options.onCheck?.({ server: name, verdict: "trusted" }), undefined;
    const ok = await options.approve({
      summary: `${options.worker} wants to use ${toolName} from ${name}`,
      reason: options.reason ?? "Allow this one call. Mark the server Trusted in Plugins to stop asking.",
    });
    options.onCheck?.({ server: name, verdict: ok ? "allowed" : "declined" });
    return ok ? undefined : "Keshab did not allow this tool call. Carry on without it, or say in the report what is needed.";
  };
}
