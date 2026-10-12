import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openHelperStore, toolCallTable, TOOL_CALLS_KEPT, TOOL_CALLS_LISTED, type HelperChange, type ToolCallEvent } from "./index.ts";

// B3.1: the activity timeline's table and the store around it.

const open = () => openHelperStore({ path: ":memory:", home: mkdtempSync(join(tmpdir(), "zeno-home-")) });
const call = (id: string, over: Partial<ToolCallEvent> = {}): ToolCallEvent => ({ id, tool: "Read", input: "/a.ts", state: "started", at: "2026-10-13T10:00:00.000Z", ...over });

test("a call is recorded, ended with its result and length, and listed oldest first", () => {
  const db = new DatabaseSync(":memory:");
  const t = toolCallTable(db);
  assert.equal(t.record(1, call("c1")), true);
  assert.equal(t.record(1, call("c2", { agent: "searcher", tool: "WebSearch", input: "q", at: "2026-10-13T10:00:01.000Z" })), true);
  assert.equal(t.record(1, call("c1", { state: "ok", result: "done", at: "2026-10-13T10:00:00.250Z" })), true);
  assert.deepEqual(t.of(1), [
    { id: "c1", tool: "Read", input: "/a.ts", state: "ok", result: "done", at: "2026-10-13T10:00:00.000Z", ms: 250 },
    { id: "c2", agent: "searcher", tool: "WebSearch", input: "q", state: "started", at: "2026-10-13T10:00:01.000Z" },
  ]);
});

test("a repeat start, an end without its start, a second end and an invalid state change nothing", () => {
  const t = toolCallTable(new DatabaseSync(":memory:"));
  assert.equal(t.record(1, call("c1")), true);
  assert.equal(t.record(1, call("c1")), false);
  assert.equal(t.record(1, call("zz", { state: "ok" })), false);
  assert.equal(t.record(1, call("c1", { state: "ok" })), true);
  assert.equal(t.record(1, call("c1", { state: "error", result: "late" })), false);
  assert.equal(t.record(1, call("c3", { state: "bogus" as never })), false);
  assert.equal(t.record(1, call("", {})), false);
  assert.equal(t.of(1).length, 1);
});

test("texts are cut to 160 and 200 characters", () => {
  const t = toolCallTable(new DatabaseSync(":memory:"));
  t.record(1, call("c1", { input: `a  ${"x".repeat(300)}` }));
  t.record(1, call("c1", { state: "ok", result: "r".repeat(300) }));
  const [row] = t.of(1);
  assert.equal(row!.input.length, 160);
  assert.equal(row!.result!.length, 200);
});

test("a task keeps its newest 200 calls; the thread lists the newest 100", () => {
  const db = new DatabaseSync(":memory:");
  const t = toolCallTable(db);
  for (let i = 0; i < TOOL_CALLS_KEPT + 5; i += 1) t.record(1, call(`c${i}`));
  const stored = db.prepare("SELECT run_key FROM tool_calls WHERE job_id = 1 ORDER BY id").all() as { run_key: string }[];
  assert.equal(stored.length, TOOL_CALLS_KEPT);
  assert.equal(stored[0]!.run_key, "c5");
  const listed = t.of(1);
  assert.equal(listed.length, TOOL_CALLS_LISTED);
  assert.equal(listed.at(-1)!.id, `c${TOOL_CALLS_KEPT + 4}`);
});

test("tasks do not see each other's calls, and the same call id may recur in two tasks", () => {
  const t = toolCallTable(new DatabaseSync(":memory:"));
  t.record(1, call("c1"));
  t.record(2, call("c1", { tool: "Glob" }));
  assert.equal(t.of(1)[0]!.tool, "Read");
  assert.equal(t.of(2)[0]!.tool, "Glob");
  t.drop(1);
  assert.deepEqual(t.of(1), []);
  assert.equal(t.of(2).length, 1);
});

test("a call still open at start-up ends as an error, 'Interrupted'", () => {
  const db = new DatabaseSync(":memory:");
  toolCallTable(db).record(1, call("c1"));
  const [row] = toolCallTable(db).of(1);
  assert.deepEqual([row!.state, row!.result], ["error", "Interrupted"]);
});

test("the table refuses a state outside started, ok and error", () => {
  const db = new DatabaseSync(":memory:");
  toolCallTable(db);
  assert.throws(() => db.prepare("INSERT INTO tool_calls (job_id, run_key, tool, input, state, started_at) VALUES (1, 'k', 't', 'i', 'weird', 'x')").run());
});

test("the store announces a start and an end (job only), ignores unknown tasks, puts the calls on toolCalls(), and drops them with the task", () => {
  const store = open();
  const changes: HelperChange[] = [];
  store.onChange((c) => changes.push(c));
  const { id } = store.addJob("sid", "Compare laptops");
  store.start(id);
  const before = changes.length;
  store.recordToolCall(id, call("c1", { input: "/secret/path.ts" }));
  store.recordToolCall(id, call("c1", { state: "ok", result: "ok" }));
  store.recordToolCall(999, call("q"));
  const announced = { action: "toolCall", helper: "sid", job: id };
  assert.deepEqual(changes.slice(before), [announced, announced]);
  assert.deepEqual(store.toolCalls(id).map((c) => [c.id, c.state]), [["c1", "ok"]]);
  assert.deepEqual(store.toolCalls(999), []);
  store.remove(id);
  assert.deepEqual(store.toolCalls(id), []);
});
