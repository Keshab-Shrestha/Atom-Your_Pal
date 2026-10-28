import { test } from "node:test";
import assert from "node:assert/strict";
import { openHelperStore } from "@atom/helpers";
import { startTinkerRunner } from "./tinker-runner.ts";

// ADR-110 N5: the small runner for Tinker's queued tasks, on a real in-memory store.

const report = { title: "T", summary: "S.", body: "B", sources: [] };
/** A done task rated "not good" queues a Tinker review; this returns that Tinker task's number. */
function review(store: ReturnType<typeof openHelperStore>, task: string): number {
  const before = new Set(store.list().find((h) => h.id === "tinker")!.jobs.map((j) => j.id));
  const done = store.addJob("sid", task);
  store.start(done.id);
  store.finish(done.id, report);
  store.rate(done.id, false);
  const fresh = store.list().find((h) => h.id === "tinker")!.jobs.find((j) => !before.has(j.id));
  assert.ok(fresh, "Tinker has a new task");
  return fresh.id;
}
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

test("a queued Tinker task starts at once and ends with its report", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const events: string[] = [];
  const runner = startTinkerRunner({
    store,
    run: async (job, { onStep }) => (onStep("thinking"), { report }),
    onRun: (e) => events.push(`${e.phase}:${e.state ?? ""}`),
  });
  const job = { id: review(store, "Review Sid") };
  await tick();
  assert.equal(store.get(job.id)!.state, "done");
  assert.deepEqual(events, ["start:", "end:done"]);
  runner.close();
  store.close();
});

test("a run that throws fails the task with its message; other helpers' tasks are left alone", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const runner = startTinkerRunner({ store, run: async () => { throw new Error("No plan"); } });
  const other = store.addJob("sid", "Not Tinker's");
  const job = { id: review(store, "Review") };
  await tick();
  assert.deepEqual([store.get(job.id)!.state, store.get(job.id)!.error], ["failed", "No plan"]);
  assert.equal(store.get(other.id)!.state, "queued");
  runner.close();
  store.close();
});

test("a stop aborts the run and its late result is dropped", async () => {
  const store = openHelperStore({ path: ":memory:" });
  let aborted = false;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const runner = startTinkerRunner({
    store,
    run: async (_job, { signal }) => {
      signal.addEventListener("abort", () => (aborted = true));
      await gate;
      return { report };
    },
  });
  const job = { id: review(store, "Review") };
  await tick();
  assert.equal(store.get(job.id)!.state, "running");
  store.stop(job.id);
  await tick();
  assert.equal(aborted, true);
  release();
  await tick();
  assert.equal(store.get(job.id)!.state, "stopped");
  runner.close();
  store.close();
});

test("a task over the time limit fails; close stops new work", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const runner = startTinkerRunner({ store, timeLimitMs: 20, run: () => new Promise(() => {}) });
  const slow = { id: review(store, "Slow") };
  await tick(80);
  assert.equal(store.get(slow.id)!.state, "failed");
  assert.match(store.get(slow.id)!.error!, /Took longer than/);
  runner.close();
  const late = { id: review(store, "Late") };
  await tick();
  assert.equal(store.get(late.id)!.state, "queued");
  store.close();
});
