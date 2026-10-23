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
