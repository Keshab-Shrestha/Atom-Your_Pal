import { test } from "node:test";
import assert from "node:assert/strict";
import { openHelperStore } from "@atom/helpers";
import { stoppedTaskSummary } from "./stopped-task-summary.ts";

test("stopped summaries count recent successful host records before Stop, never pending, failed or later calls", () => {
  let clock = Date.parse("2026-10-27T00:00:00Z");
  const store = openHelperStore({ path: ":memory:", now: () => new Date(clock) });
  const job = store.addNativeJob("kame", "Fictional Cedar reads", { chatId: "cedar" });
  const at = (n: number) => new Date(clock + n).toISOString();
  try {
    for (let i = 0; i < 5; i++) {
      store.recordToolCall(job.id, { id: `r${i}`, tool: "Read", input: "fictional", state: "started", at: at(i * 10) });
      store.recordToolCall(job.id, { id: `r${i}`, tool: "Read", input: "", state: "ok", at: at(i * 10 + 1) });
    }
    store.recordToolCall(job.id, { id: "pending", tool: "Read", input: "", state: "started", at: at(50) });
    store.recordToolCall(job.id, { id: "failed", tool: "Edit", input: "", state: "started", at: at(51) });
    store.recordToolCall(job.id, { id: "failed", tool: "Edit", input: "", state: "error", at: at(52) });
    store.recordToolCall(job.id, { id: "late", tool: "Read", input: "", state: "started", at: at(53) });
    store.recordToolCall(job.id, { id: "late", tool: "Read", input: "", state: "ok", at: at(500) });
    clock += 100; store.stop(job.id);
    const summary = stoppedTaskSummary(store, "cedar", [{ job: job.id, stopped: true }])!;
    assert.match(summary, /Read × 5/);
    assert.doesNotMatch(summary, /Edit ×|Read × [678]/);
    assert.match(summary, /Files may already have changed/);
    assert.doesNotMatch(summary, /fictional/);
  } finally { store.close(); }
});

test("unavailable attempt history withholds counts; mixed notifications retain other result links without cross-chat details", () => {
  const store = openHelperStore({ path: ":memory:" });
  try {
    const stopped = store.addNativeJob("kame", "Cedar", { chatId: "cedar" }); store.stop(stopped.id);
    const done = store.addNativeJob("quill", "Cedar result", { chatId: "cedar" });
    store.finish(done.id, { title: "Cedar", summary: "Fictional", body: "Done", sources: [] });
    const foreign = store.addNativeJob("sid", "Private other chat task", { chatId: "other" }); store.stop(foreign.id);
    const view = { get: store.get.bind(store), toolCalls: store.toolCalls.bind(store) };
    const summary = stoppedTaskSummary(view, "cedar", [{ job: stopped.id, stopped: true }, { job: done.id, stopped: false }, { job: foreign.id, stopped: true }])!;
    assert.match(summary, /counts are unavailable/);
    assert.match(summary, new RegExp(`Task #${done.id}: report saved`));
    assert.doesNotMatch(summary, new RegExp(`Task #${foreign.id}`));
    assert.doesNotMatch(summary, /Private other chat/);
    assert.equal(stoppedTaskSummary(store, "cedar", [{ job: done.id, stopped: false }]), undefined);
  } finally { store.close(); }
});

test("a previous attempt's tool records never count as this stopped attempt's activity", () => {
  const summary = stoppedTaskSummary({
    get: () => ({ id: 1, chatId: "cedar", state: "stopped" }) as never,
    taskEvidence: () => ({ attempt: "current", state: "stopped", startedAt: "2026-10-27T00:01:00Z", endedAt: "2026-10-27T00:02:00Z" }) as never,
    toolCalls: () => [{ id: "old", tool: "Read", input: "", state: "ok", at: "2026-10-27T00:00:00Z", ms: 10 }],
  }, "cedar", [{ job: 1, stopped: true }])!;
  assert.match(summary, /No successful calls are shown/);
  assert.doesNotMatch(summary, /Read ×/);
});
