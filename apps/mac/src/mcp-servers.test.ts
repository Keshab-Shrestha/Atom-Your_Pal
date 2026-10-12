import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@atom/helpers";
import { mcpCheck, sdkConfig, testMcpServer } from "./mcp-servers.ts";

// ADR-090: Keshab's MCP servers at run time.

const base: McpServer = { id: 1, name: "echo", kind: "command", args: [], env: {}, transport: "http", headers: {}, enabled: true, trusted: false, workers: ["sid"], tools: [] };

test("a real stdio MCP server: the test completes the handshake and lists its tools", async () => {
  const fixture = fileURLToPath(new URL("./fixtures/echo-mcp.mjs", import.meta.url));
  const outcome = await testMcpServer({ ...base, command: process.execPath, args: [fixture] }, 20_000);
  assert.deepEqual(outcome, { tools: ["echo"] });
});

test("a server that is not one says so in words, without its output", async () => {
  const outcome = await testMcpServer({ ...base, command: "/usr/bin/false" }, 5_000);
  assert.ok("problem" in outcome && /did not answer as an MCP server/.test(outcome.problem));
});

test("configs for the Agent SDK", () => {
  assert.deepEqual(sdkConfig({ ...base, command: "notes", args: ["-x"], env: { T: "1" } }), { type: "stdio", command: "notes", args: ["-x"], env: { T: "1" } });
  assert.deepEqual(sdkConfig({ ...base, kind: "url", url: "https://x/mcp", transport: "sse", headers: { A: "b" } }), { type: "sse", url: "https://x/mcp", headers: { A: "b" } });
});

test("a trusted server's tools run; any other asks on the card, and no is a refusal", async () => {
  const asked: string[] = [];
  let answer = false;
  const logged: unknown[] = [];
  const check = mcpCheck({
    servers: [{ ...base, name: "notes", trusted: true }, { ...base, name: "mail" }],
    worker: "Sid",
    approve: async (r) => (asked.push(r.summary), answer),
    onCheck: (e) => logged.push(e),
  });
  assert.equal(await check("mcp__notes__search"), undefined);
  assert.match((await check("mcp__mail__send"))!, /did not allow/);
  answer = true;
  assert.equal(await check("mcp__mail__send"), undefined);
  assert.match((await check("mcp__other__x"))!, /not one of this worker's/);
  assert.deepEqual(asked, ["Sid wants to use send from mail", "Sid wants to use send from mail"]);
  assert.deepEqual(logged.map((e) => (e as { verdict: string }).verdict), ["trusted", "declined", "allowed"]);
});
