import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentCursor } from "./agent-cursor.ts";

function fake(size: Record<string, unknown> = { width: 1920, height: 1080 }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const cua = { async call(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return { text: "", isError: false, refusal: undefined, data: name === "get_screen_size" ? size : {} }; } };
  return { cua, calls };
}

test("the agent cursor glides with actions and rests at ATOM's island when the task ends", async () => {
  const { cua, calls } = fake();
  const cursor = createAgentCursor(cua, async () => {});
  await cursor.start();
  await cursor.finish();
  assert.deepEqual(calls.map((c) => c.name), ["set_agent_cursor_motion", "set_agent_cursor_enabled", "get_screen_size", "move_cursor", "set_agent_cursor_enabled"]);
  assert.deepEqual(calls[0]!.args, { glide_duration_ms: 400, arc_size: 0, arc_flow: 0, turn_radius: 0, spring: 1 }, "near-straight, no overshoot");
  assert.deepEqual(calls[1]!.args, { enabled: true });
  assert.deepEqual(calls[3]!.args, { x: 960, y: 14 });
  assert.deepEqual(calls[4]!.args, { enabled: false });
  assert.ok(calls.every((c) => c.args.scope !== "desktop"), "the user's real pointer is never moved");
});

test("an unreadable screen size still hides the agent cursor", async () => {
  const { cua, calls } = fake({});
  await createAgentCursor(cua, async () => {}).finish();
  assert.deepEqual(calls.map((c) => c.name), ["get_screen_size", "set_agent_cursor_enabled"]);
});

test("a failed return-to-island call still disables the cursor", async () => {
  const { cua, calls } = fake();
  const call = cua.call;
  cua.call = async (name, args) => {
    if (name === "get_screen_size") throw new Error("driver unavailable");
    return call(name, args);
  };
  await assert.rejects(createAgentCursor(cua, async () => {}).finish(), /driver unavailable/);
  assert.deepEqual(calls, [{ name: "set_agent_cursor_enabled", args: { enabled: false } }]);
});

test("an older finish cannot hide the cursor after a new task starts", async () => {
  const { cua, calls } = fake();
  let release!: () => void;
  const cursor = createAgentCursor(cua, () => new Promise<void>((r) => { release = r; }));
  await cursor.start();
  const finishing = cursor.finish();
  await new Promise<void>((r) => setImmediate(r));
  await cursor.start();
  release();
  await finishing;
  assert.deepEqual(calls.filter((c) => c.name === "set_agent_cursor_enabled").map((c) => c.args.enabled), [true, true]);
});

test("a slow start cannot enable the cursor after its task ended", async () => {
  const { cua, calls } = fake();
  const call = cua.call;
  let release!: () => void;
  cua.call = async (name, args) => {
    if (name === "set_agent_cursor_motion") await new Promise<void>((r) => { release = r; });
    return call(name, args);
  };
  const cursor = createAgentCursor(cua, async () => {});
  const starting = cursor.start();
  await cursor.finish();
  release();
  await starting;
  assert.deepEqual(calls.filter((c) => c.name === "set_agent_cursor_enabled").map((c) => c.args.enabled), [false]);
});

test("driver error results are reported as cursor failures", async () => {
  const { cua } = fake();
  cua.call = async () => ({ text: "unsupported", isError: true, refusal: undefined, data: {} });
  await assert.rejects(createAgentCursor(cua).start(), /cursor/i);
});
