import { test } from "node:test";
import assert from "node:assert/strict";
import { runOne, toolBridge } from "./claude-bridge.ts";
import type { ClaudeSdk } from "./plan-support.ts";

type Msg = Record<string, unknown>;
const delta = (d: Msg): Msg => ({ type: "stream_event", event: { type: "content_block_delta", delta: d } });

function run(script: Msg[], env: Record<string, string> = { PATH: "/bin", ANTHROPIC_API_KEY: "sk-x" }) {
  const seen: Record<string, any>[] = [];
  const sdk = { query: ({ options }: { options: Record<string, any> }) => (seen.push(options), (async function* () { yield* script; })()) } as unknown as ClaudeSdk;
  const lines: Msg[] = [];
  return runOne(sdk, { id: "7", prompt: "hi", model: "m" }, (l) => lines.push(l), new AbortController(), env).then(() => ({ lines, options: seen[0]! }));
}

test("streams text and thinking, ends with done, and uses the safe options", async () => {
  const { lines, options } = await run([
    { type: "system", subtype: "init", apiKeySource: "none", session_id: "s1" },
    delta({ type: "text_delta", text: "Hel" }),
    delta({ type: "thinking_delta", thinking: "hm" }),
    delta({ type: "text_delta", text: "lo" }),
    { type: "result", is_error: false, stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 2 } },
  ]);
  assert.deepEqual(lines, [
    { id: "7", type: "text", text: "Hel" },
    { id: "7", type: "thinking", text: "hm" },
    { id: "7", type: "text", text: "lo" },
    { id: "7", type: "done", stopReason: "end_turn", usage: { input: 5, output: 2 }, sessionId: "s1" },
  ]);
  assert.equal(options.strictMcpConfig, true);
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.env.ANTHROPIC_API_KEY, undefined, "the API key is scrubbed");
});

test("stops with an error when Claude Code reports an API key", async () => {
  const { lines } = await run([{ type: "system", subtype: "init", apiKeySource: "ANTHROPIC_API_KEY" }]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.type, "error");
  assert.match(String(lines[0]!.message), /bills per token/);
});

test("a tool call goes to Rust as a tool line and the tool_result line answers it", async () => {
  const lines: Msg[] = [];
  const bridge = toolBridge((l) => lines.push(l));
  const first = bridge.call("current_time", { timezone: "UTC" });
  const second = bridge.call("read_file", { path: "/a" });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(lines, [
    { type: "tool", callId: "call-1", name: "current_time", input: { timezone: "UTC" } },
    { type: "tool", callId: "call-2", name: "read_file", input: { path: "/a" } },
  ], "calls go out at once");
  bridge.deliver("call-2", "no", true);
  bridge.deliver("call-1", "12:00", false);
  assert.deepEqual(await first, { content: "12:00", isError: false });
  assert.deepEqual(await second, { content: "no", isError: true });
});

test("a run with tools mounts the in-process server and allows only those tools", async () => {
  const seen: Record<string, any>[] = [];
  const sdk = {
    query: ({ options }: { options: Record<string, any> }) => (seen.push(options), (async function* () { yield { type: "result", is_error: false, usage: {} }; })()),
    tool: (name: string) => ({ name }),
    createSdkMcpServer: (o: { tools: unknown[] }) => ({ tools: o.tools }),
  } as unknown as ClaudeSdk;
  const spec = { name: "current_time", description: "d", inputSchema: { type: "object" as const, properties: {} } };
  await runOne(sdk, { id: "1", prompt: "hi", tools: [spec] }, () => {}, new AbortController(), { PATH: "/bin" }, toolBridge(() => {}));
  assert.deepEqual(seen[0]!.allowedTools, ["mcp__ark__current_time"]);
  assert.deepEqual(seen[0]!.tools, [], "no built-in tools");
  assert.equal(seen[0]!.strictMcpConfig, true);
  assert.ok(seen[0]!.mcpServers.ark);
});
