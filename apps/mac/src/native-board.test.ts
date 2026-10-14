import { test } from "node:test";
import assert from "node:assert/strict";
import { openHelperStore } from "@atom/helpers";
import { boardRecorder, reportFrom } from "./native-board.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = (hooks: Record<string, unknown>, event: string, input: Record<string, unknown>) =>
  (hooks[event] as { hooks: ((i: unknown) => Promise<unknown>)[] }[])[0]!.hooks[0]!(input);

test("a sub-agent's stream becomes Board rows: the job runs, steps, tool calls (redacted), usage, then the plain-text report", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const ended: number[] = [];
  const board = boardRecorder(store, "chat-1", { onEnd: (job) => void ended.push(job) });
  const job = store.addNativeJob("sid", "Find cheap flights to Kathmandu", { chatId: "chat-1" });
  board.opened("toolu_1", job.id, "Cheap flights to Kathmandu");

  board.onEvent({ type: "system", subtype: "task_started", task_id: "agent-7", tool_use_id: "toolu_1", subagent_type: "sid", description: "Cheap flights" });
  assert.equal(store.get(job.id)!.sdkTaskId, "agent-7");
  assert.equal(board.taskOf(job.id), "agent-7");
  board.onEvent({ type: "system", subtype: "task_progress", task_id: "agent-7", description: "x", last_tool_name: "WebSearch", usage: {} });
  assert.equal(store.get(job.id)!.step, "Using WebSearch");
  board.onEvent({
    type: "assistant",
    parent_tool_use_id: "toolu_1",
    message: {
      model: "claude-haiku-5",
      usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 },
      content: [{ type: "tool_use", id: "t1", name: "WebFetch", input: { url: "https://user:secret@example.com/a" } }],
    },
  });
  board.onEvent({ type: "user", parent_tool_use_id: "toolu_1", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "page text" }] } });
  const calls = store.toolCalls(job.id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.tool, "WebFetch");
  assert.ok(!JSON.stringify(calls).includes("secret"), "ADR-099: the URL's password is redacted");

  await run(board.hooks, "SubagentStart", { agent_id: "agent-7", agent_type: "sid" });
  assert.equal(board.jobOfAgent("agent-7"), job.id);
  await run(board.hooks, "SubagentStop", {
    agent_id: "agent-7",
    agent_type: "sid",
    last_assistant_message: "Three flights under $400. See https://flights.example.com/ktm and https://news.example.org/x.",
  });
  const done = store.get(job.id)!;
  assert.equal(done.state, "done");
  const report = store.report(job.id)!;
  assert.equal(report.title, "Cheap flights to Kathmandu");
  assert.equal(report.summary, "Three flights under $400.");
  assert.deepEqual(report.sources.map((s) => s.url), ["https://flights.example.com/ktm", "https://news.example.org/x"]);
  const usage = store.usage();
  assert.ok(JSON.stringify(usage).includes("900"), "the sub-agent's cache reads are counted");
  await sleep(5);
  assert.deepEqual(ended, [job.id]);
  // The task_notification that follows changes nothing.
  board.onEvent({ type: "system", subtype: "task_notification", task_id: "agent-7", status: "completed", summary: "x", output_file: "" });
  assert.equal(store.get(job.id)!.state, "done");
  assert.deepEqual(board.running(), []);
  store.close();
});

test("a stopped or failed task, and an Agent call that never started, end their jobs", () => {
  const store = openHelperStore({ path: ":memory:" });
  const board = boardRecorder(store, "chat-1");
  const a = store.addNativeJob("sid", "a", { chatId: "chat-1" });
  const b = store.addNativeJob("hana", "b", { chatId: "chat-1" });
  const c = store.addNativeJob("sid", "c", { chatId: "chat-1" });
  board.opened("u1", a.id, "A");
  board.opened("u2", b.id, "B");
  board.opened("u3", c.id, "C");
  board.onEvent({ type: "system", subtype: "task_started", task_id: "t1", tool_use_id: "u1" });
  board.onEvent({ type: "system", subtype: "task_started", task_id: "t2", tool_use_id: "u2" });
  board.onEvent({ type: "system", subtype: "task_notification", task_id: "t1", status: "stopped", summary: "", output_file: "" });
  board.onEvent({ type: "system", subtype: "task_notification", task_id: "t2", status: "failed", summary: "It broke.", output_file: "" });
  board.onEvent({ type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "u3", is_error: true, content: "Agent type not found" }] } });
  assert.equal(store.get(a.id)!.state, "stopped");
  assert.equal(store.get(b.id)!.state, "failed");
  assert.equal(store.get(b.id)!.error, "It broke.");
  assert.equal(store.get(c.id)!.state, "failed");
  store.close();
});

test("a financial report ends with the notice; a report without a link has no sources", () => {
  const r = reportFrom("Rates rose. Details follow.", "Rates", "financial adviser");
  assert.match(r.body, /not professional financial advice\.$/);
  assert.deepEqual(r.sources, []);
});

test("the report, the step line and failure text are masked before they are kept (ADR-099)", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const board = boardRecorder(store, "chat-1");
  const a = store.addNativeJob("sid", "x", { chatId: "chat-1" });
  const b = store.addNativeJob("sid", "y", { chatId: "chat-1" });
  board.opened("u-a", a.id, "A");
  board.opened("u-b", b.id, "B");
  board.onEvent({ type: "system", subtype: "task_started", task_id: "ag-a", tool_use_id: "u-a" });
  board.onEvent({ type: "system", subtype: "task_started", task_id: "ag-b", tool_use_id: "u-b" });
  board.onEvent({ type: "system", subtype: "task_progress", task_id: "ag-a", summary: "Logging in with password=hunter2" });
  assert.ok(!store.get(a.id)!.step!.includes("hunter2"));
  await run(board.hooks, "SubagentStop", { agent_id: "ag-a", agent_type: "sid", last_assistant_message: "Done. Use https://admin:hunter2@db.example.com/x to log in." });
  const report = store.report(a.id)!;
  assert.ok(!JSON.stringify(report).includes("hunter2"), "the password in the URL is masked");
  assert.deepEqual(report.sources.map((s) => s.url), ["https://db.example.com/x"]);
  board.onEvent({ type: "system", subtype: "task_notification", task_id: "ag-b", status: "failed", summary: "Auth failed with Bearer abc.def.ghi" });
  assert.ok(!store.get(b.id)!.error!.includes("abc.def.ghi"));
  store.close();
});

test("Phase N3: the job's model is the one Claude Code ran the agent on, from its usage or its AgentOutput", () => {
  const store = openHelperStore({ path: ":memory:" });
  const board = boardRecorder(store, "chat-1");
  const a = store.addNativeJob("sid", "Find flights", { chatId: "chat-1" });
  const b = store.addNativeJob("sid", "Find hotels", { chatId: "chat-1" });
  board.opened("toolu_a", a.id, "Flights");
  board.opened("toolu_b", b.id, "Hotels");
  board.onEvent({ type: "assistant", parent_tool_use_id: "toolu_a", message: { model: "claude-haiku-5", usage: { input_tokens: 5, output_tokens: 1 }, content: [] } });
  assert.equal(store.get(a.id)!.model, "claude-haiku-5");
  board.onEvent({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_b", content: "done" }] },
    tool_use_result: { status: "completed", agentId: "agent-b", resolvedModel: "claude-sonnet-5", usage: { input_tokens: 5, output_tokens: 1 } },
  });
  assert.equal(store.get(b.id)!.model, "claude-sonnet-5");
  store.close();
});
