import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// ADR-098 item 5: the MCP entry, run as a real child process. ATOM_API_PORT=1 so no real ATOM can answer.

const entry = fileURLToPath(new URL("./mcp-serve.ts", import.meta.url));

function session(messages: object[]) {
  return new Promise<{ lines: string[]; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { env: { ...process.env, ATOM_API_PORT: "1" } });
    let out = "";
    let err = "";
    const lines = () => out.split("\n").filter(Boolean);
    child.stdout.on("data", (c) => {
      out += c;
      if (lines().filter((l) => l.includes('"id"')).length >= messages.filter((m: any) => m.id !== undefined).length) child.stdin.end();
    });
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", () => resolve({ lines: lines(), stderr: err }));
    setTimeout(() => child.kill(), 15_000).unref();
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
  });
}

const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
const initialized = { jsonrpc: "2.0", method: "notifications/initialized" };

test("stdout holds only JSON-RPC messages; tools are listed; an unreachable ATOM is a tool error", async () => {
  const r = await session([
    init, initialized,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "atom_needs_you", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
  ]);
  const msgs = r.lines.map((l) => JSON.parse(l));
  assert.ok(msgs.every((m) => m.jsonrpc === "2.0"), "every stdout line is JSON-RPC");
  const by = (id: number) => msgs.find((m) => m.id === id);
  assert.deepEqual(by(2).result.tools.map((t: any) => t.name).sort(), ["atom_answer_need", "atom_chat", "atom_give_goal", "atom_goal_status", "atom_list_tasks", "atom_needs_you", "atom_task_report"]);
  assert.equal(by(3).result.isError, true);
  assert.match(by(3).result.content[0].text, /token|does not answer/i);
  assert.equal(by(4).result.isError, true);
});

test("atom_answer_need needs key and action, and an unreachable ATOM is a tool error", async () => {
  const r = await session([
    init, initialized,
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "atom_answer_need", arguments: { key: "q1", action: "allow" } } },
  ]);
  const msgs = r.lines.map((l) => JSON.parse(l));
  assert.ok(msgs.every((m) => m.jsonrpc === "2.0"));
  const res = msgs.find((m) => m.id === 2).result;
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /token|does not answer/i);
});
