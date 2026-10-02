import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolEngine, type Tool } from "./engine.ts";
import { timeTool } from "./tools/time.ts";

const echo: Tool = {
  spec: {
    name: "echo",
    description: "Echoes text",
    inputSchema: { type: "object", properties: { text: { type: "string" }, times: { type: "number" } }, required: ["text"] },
  },
  run: (input) => String(input.text).repeat(Number(input.times ?? 1)),
};

test("runs a tool and returns its words", async () => {
  const engine = createToolEngine({ tools: [echo] });
  assert.deepEqual(await engine.run({ id: "c1", name: "echo", input: { text: "hi", times: 2 } }), { callId: "c1", content: "hihi" });
});

test("lists the tool specs", () => {
  assert.deepEqual(createToolEngine({ tools: [echo] }).specs().map((s) => s.name), ["echo"]);
});

test("an unknown tool comes back as an error result, not a throw", async () => {
  const r = await createToolEngine({ tools: [echo] }).run({ id: "c", name: "rm_rf", input: {} });
  assert.equal(r.isError, true);
  assert.match(r.content, /no tool called "rm_rf"/);
});

test("rejects input that does not match the schema", async () => {
  const engine = createToolEngine({ tools: [echo] });
  const cases: Array<[unknown, RegExp]> = [
    [{}, /"text" is missing/],
    [{ text: 5 }, /must be string, not number/],
    [{ text: "a", extra: 1 }, /"extra" is not an input/],
    [null, /must be an object/],
    [["a"], /must be an object/],
  ];
  for (const [input, message] of cases) {
    const r = await engine.run({ id: "c", name: "echo", input: input as Record<string, unknown> });
    assert.equal(r.isError, true, JSON.stringify(input));
    assert.match(r.content, message);
  }
});

test("a throwing tool becomes an error result", async () => {
  const boom: Tool = { spec: { name: "boom", description: "x", inputSchema: { type: "object" } }, run: () => { throw new Error("nope"); } };
  const r = await createToolEngine({ tools: [boom] }).run({ id: "c", name: "boom", input: {} });
  assert.deepEqual(r, { callId: "c", content: '"boom" failed: nope', isError: true });
});

test("a cancelled call does not run the tool", async () => {
  let ran = false;
  const t: Tool = { spec: { name: "t", description: "x", inputSchema: { type: "object" } }, run: () => { ran = true; return "x"; } };
  const ac = new AbortController();
  ac.abort();
  const r = await createToolEngine({ tools: [t] }).run({ id: "c", name: "t", input: {} }, ac.signal);
  assert.equal(r.isError, true);
  assert.equal(ran, false);
});

test("long results are cut and say so", async () => {
  const big: Tool = { spec: { name: "big", description: "x", inputSchema: { type: "object" } }, run: () => "a".repeat(50) };
  const r = await createToolEngine({ tools: [big], maxResultChars: 10 }).run({ id: "c", name: "big", input: {} });
  assert.equal(r.content, "aaaaaaaaaa\n[cut: 40 more characters]");
});

test("onCall reports name, outcome and time, never the output", async () => {
  const events: unknown[] = [];
  let t = 100;
  const engine = createToolEngine({ tools: [echo], onCall: (e) => events.push(e), now: () => (t += 5) });
  await engine.run({ id: "1", name: "echo", input: { text: "secret" } });
  await engine.run({ id: "2", name: "nope", input: {} });
  assert.deepEqual(events, [
    { name: "echo", ok: true, ms: 5 },
    { name: "nope", ok: false, reason: "unknown_tool", ms: 5 },
  ]);
});

test("two tools with one name are refused", () => {
  assert.throws(() => createToolEngine({ tools: [echo, echo] }), /share a name/);
});

test("current_time formats in a given time zone and rejects a bad one", async () => {
  const engine = createToolEngine({ tools: [timeTool(() => new Date("2026-10-02T15:30:00Z"))] });
  const tokyo = await engine.run({ id: "1", name: "current_time", input: { timezone: "Asia/Tokyo" } });
  assert.match(tokyo.content, /Saturday, 3 October 2026/);
  assert.match(tokyo.content, /00:30:00/);
  const bad = await engine.run({ id: "2", name: "current_time", input: { timezone: "Mars/Base" } });
  assert.equal(bad.isError, true);
});
