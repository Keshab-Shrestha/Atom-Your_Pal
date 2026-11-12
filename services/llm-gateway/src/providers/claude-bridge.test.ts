import { test } from "node:test";
import assert from "node:assert/strict";
import { runOne } from "./claude-bridge.ts";
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
