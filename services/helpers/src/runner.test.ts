import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JOB_TIME_LIMIT_MS, openHelperStore, startJobRunner, type Job, type JobRun, type RunContext, type RunEvent, type RunOutcome } from "./index.ts";

const report = { title: "TCP and UDP", summary: "How they differ.", body: "One.\n\nTwo.", sources: [{ title: "RFC", url: "https://example.org/" }] };
const tick = () => new Promise((r) => setTimeout(r, 5));

/** A fake run: every call waits until the test settles it. */
function fakeRun() {
  const calls: { job: Job; context: RunContext; resolve(o: RunOutcome): void; reject(e: unknown): void }[] = [];
  const run: JobRun = (job, context) =>
    new Promise((resolve, reject) => {
      calls.push({ job, context, resolve, reject });
    });
  const started = () => calls.map((c) => c.job.id);
  const call = (id: number) => calls.find((c) => c.job.id === id)!;
  return { run, calls, started, call };
}

/** A store in a temp file, with jobs inserted directly. */
function fileStore(jobs: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "atom-runner-"));
  const path = join(dir, "helpers.db");
  const store = openHelperStore({ path });
  const db = new DatabaseSync(path);
  const insert = db.prepare("INSERT INTO jobs (helper, task, state, created_at) VALUES (?, 'task', 'queued', ?)");
  for (const helper of jobs) insert.run(helper, new Date().toISOString());
  db.close();
  return { store, path, done: () => (store.close(), rmSync(dir, { recursive: true, force: true })) };
}

test("default: fifteen minutes a job", () => {
  assert.equal(JOB_TIME_LIMIT_MS, 15 * 60_000);
});

test("jobs queued before the runner starts (a restart) are picked up, oldest first", async () => {
  const { store, done } = fileStore(["sid", "sid", "kame"]);
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run });
  await tick();
  assert.deepEqual(fake.started(), [1, 2, 3]); // ADR-110 N4: no run limit; Sid's two jobs and Kame's run at once
  assert.equal(store.get(3)!.state, "running");
  fake.call(1).resolve({ report });
  await tick();
  assert.equal(store.get(1)!.state, "done");
  assert.equal(store.report(1)!.title, "TCP and UDP");
  runner.close();
  done();
});

test("ADR-110 N4: many jobs run at once; a plan waiting for OK or an interrupted run waits for Keshab", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run });
  const jobs = ["a", "b", "c", "d", "e", "f", "g", "h"].map((t) => store.addJob("sid", t));
  await tick();
  assert.deepEqual(fake.started(), jobs.map((j) => j.id), "more than the old six at once");
  fake.call(jobs[0]!.id).resolve({ interrupted: true });
  await tick();
  assert.equal(store.get(jobs[0]!.id)!.interrupted, true);
  assert.equal(fake.calls.filter((c) => c.job.id === jobs[0]!.id).length, 1, "the interrupted task waits");
  runner.close();
});

test("Sid's jobs start in the order given, and a job added later starts by itself", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const fake = fakeRun();
  const events: RunEvent[] = [];
  const runner = startJobRunner({ store, run: fake.run, onRun: (e) => events.push(e) });
  const a = store.addJob("sid", "first");
  await tick();
  assert.deepEqual(fake.started(), [a.id]);
  fake.call(a.id).context.onStep("Searching the web");
  assert.equal(store.get(a.id)!.step, "Searching the web");
  fake.call(a.id).resolve({ report, partial: true, pages: 12 });
  const b = store.addJob("sid", "second");
  await tick();
  assert.deepEqual(fake.started(), [a.id, b.id]);
  assert.equal(store.get(a.id)!.partial, true);
  const end = events.find((e) => e.phase === "end")!;
  assert.deepEqual({ ...end, ms: 0 }, { phase: "end", helper: "sid", job: a.id, state: "done", ms: 0, pages: 12, partial: true });
  assert.ok(!JSON.stringify(events).includes("first")); // never the task
  runner.close();
});

test("a failing run fails the job with its message, and the queue moves on", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run });
  const a = store.addJob("sid", "one");
  await tick();
  fake.call(a.id).reject(new Error("Sid needs the Claude plan for research."));
  await tick();
  assert.equal(store.get(a.id)!.state, "failed");
  assert.equal(store.get(a.id)!.error, "Sid needs the Claude plan for research.");
  const b = store.addJob("sid", "two");
  await tick();
  assert.deepEqual(fake.started(), [a.id, b.id]);
  runner.close();
});

test("job.stop mid-run aborts the run at once and drops its late result", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run });
  const a = store.addJob("sid", "one");
  const b = store.addJob("sid", "two");
  await tick();
  const { context, resolve } = fake.call(a.id);
  store.stop(a.id);
  assert.equal(context.signal.aborted, true); // synchronously, well within a second
  await tick();
  assert.deepEqual(fake.started(), [a.id, b.id]); // the other job runs on
  assert.equal(store.get(b.id)!.state, "running");
  resolve({ report });
  context.onStep("late");
  await tick();
  assert.equal(store.get(a.id)!.state, "stopped");
  assert.equal(store.report(a.id), undefined);
  runner.close();
});

test("job.delete mid-run aborts the run and nothing is written for it afterwards", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run });
  const a = store.addJob("sid", "one");
  await tick();
  const { context, resolve } = fake.call(a.id);
  store.remove(a.id);
  assert.equal(context.signal.aborted, true);
  resolve({ report });
  await tick();
  assert.equal(store.get(a.id), undefined);
  assert.equal(store.report(a.id), undefined);
  runner.close();
});

test("the time limit aborts the run: failed without a result, done and partial with one", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run, timeLimitMs: 20, graceMs: 20 });
  const a = store.addJob("sid", "slow, nothing back");
  await new Promise((r) => setTimeout(r, 200)); // the limit, one automatic retry (ADR-090), the limit again
  assert.equal(fake.call(a.id).context.signal.aborted, true);
  assert.equal(store.get(a.id)!.state, "failed");
  assert.equal(store.get(a.id)!.autoRetries, 1);
  assert.match(store.get(a.id)!.error!, /^Took longer than/);

  const b = store.addJob("sid", "slow, partial back");
  await new Promise((r) => setTimeout(r, 30)); // past the limit, inside the grace
  const call = fake.call(b.id);
  assert.equal(call.context.signal.aborted, true);
  call.resolve({ report });
  await tick();
  assert.equal(store.get(b.id)!.state, "done");
  assert.equal(store.get(b.id)!.partial, true);
  runner.close();
});
