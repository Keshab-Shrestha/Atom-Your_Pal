import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JOB_TIME_LIMIT_MS, MAX_RUNNING, openHelperStore, startJobRunner, type Job, type JobRun, type RunContext, type RunEvent, type RunOutcome } from "./index.ts";

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

test("defaults: six jobs at once (ADR-095), fifteen minutes each", () => {
  assert.equal(MAX_RUNNING, 6);
  assert.equal(JOB_TIME_LIMIT_MS, 15 * 60_000);
});

test("jobs queued before the runner starts (a restart) are picked up, oldest first", async () => {
  const { store, done } = fileStore(["sid", "sid", "kame"]);
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run, maxRunning: 2 });
  await tick();
  assert.deepEqual(fake.started(), [1, 2]); // ADR-095: Sid's two jobs run at once; Kame's waits for a slot
  assert.equal(store.get(2)!.state, "running");
  assert.equal(store.get(3)!.state, "queued");
  fake.call(1).resolve({ report });
  await tick();
  assert.deepEqual(fake.started(), [1, 2, 3]);
  assert.equal(store.get(1)!.state, "done");
  assert.equal(store.report(1)!.title, "TCP and UDP");
  runner.close();
  done();
});

test("no more than the running limit at once; the next starts when one ends", async () => {
  const { store, done } = fileStore(["sid", "kame", "puff"]);
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run, maxRunning: 2 });
  await tick();
  assert.deepEqual(fake.started(), [1, 2]);
  fake.call(2).resolve({ report });
  await tick();
  assert.deepEqual(fake.started(), [1, 2, 3]);
  runner.close();
  done();
});

test("with one run at a time, Sid's jobs run in the order given, and a job added later starts by itself", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const fake = fakeRun();
  const events: RunEvent[] = [];
  const runner = startJobRunner({ store, run: fake.run, maxRunning: 1, onRun: (e) => events.push(e) });
  const a = store.addJob("sid", "first");
  const b = store.addJob("sid", "second");
  await tick();
  assert.deepEqual(fake.started(), [a.id]);
  fake.call(a.id).context.onStep("Searching the web");
  assert.equal(store.get(a.id)!.step, "Searching the web");
  fake.call(a.id).resolve({ report, partial: true, pages: 12 });
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
  const runner = startJobRunner({ store, run: fake.run, maxRunning: 1 });
  const a = store.addJob("sid", "one");
  const b = store.addJob("sid", "two");
  await tick();
  fake.call(a.id).reject(new Error("Sid needs the Claude plan for research."));
  await tick();
  assert.equal(store.get(a.id)!.state, "failed");
  assert.equal(store.get(a.id)!.error, "Sid needs the Claude plan for research.");
  assert.deepEqual(fake.started(), [a.id, b.id]);
  runner.close();
});

test("job.stop mid-run aborts the run at once and drops its late result", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run, maxRunning: 1 });
  const a = store.addJob("sid", "one");
  const b = store.addJob("sid", "two");
  await tick();
  const { context, resolve } = fake.call(a.id);
  store.stop(a.id);
  assert.equal(context.signal.aborted, true); // synchronously, well within a second
  await tick();
  assert.deepEqual(fake.started(), [a.id, b.id]); // the next job is not held up
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

test("ADR-095: two jobs of one worker run at once, up to the limit from Settings, which applies when changed", async () => {
  const store = openHelperStore({ path: ":memory:" });
  store.setMaxRunning(2);
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run, maxRunning: () => store.maxRunning() });
  const [a, b, c] = ["one", "two", "three"].map((t) => store.addJob("sid", t));
  await tick();
  assert.deepEqual(fake.started(), [a!.id, b!.id], "both of Sid's first two at once; the third waits for a slot");
  store.setMaxRunning(3); // a "budget" change: the runner looks again by itself
  await tick();
  assert.deepEqual(fake.started(), [a!.id, b!.id, c!.id]);
  store.setMaxRunning(1); // lowering it stops nothing that runs; new runs wait until fewer run
  const d = store.addJob("sid", "four");
  fake.call(a!.id).resolve({ report });
  fake.call(b!.id).resolve({ report });
  await tick();
  assert.equal(store.get(d.id)!.state, "queued", "still one running");
  fake.call(c!.id).resolve({ report });
  await tick();
  assert.equal(store.get(d.id)!.state, "running");
  assert.throws(() => store.setMaxRunning(0), /from 1 to 10/);
  assert.throws(() => store.setMaxRunning(11), /from 1 to 10/);
  assert.throws(() => store.setMaxRunning(2.5), /from 1 to 10/);
  assert.equal(store.budgets().maxRunning, 1);
  runner.close();
});

test("Runs at once defaults to 6 and is kept in the helpers file", () => {
  const { store, path, done } = fileStore([]);
  assert.equal(store.maxRunning(), MAX_RUNNING);
  store.setMaxRunning(4);
  const again = openHelperStore({ path });
  assert.equal(again.budgets().maxRunning, 4);
  again.close();
  done();
});

test("close aborts running jobs and writes nothing; queued jobs wait for the next start", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const fake = fakeRun();
  const runner = startJobRunner({ store, run: fake.run });
  const a = store.addJob("sid", "one");
  await tick();
  runner.close();
  assert.equal(fake.call(a.id).context.signal.aborted, true);
  const b = store.addJob("sid", "two");
  fake.call(a.id).resolve({ report });
  await tick();
  assert.equal(store.get(a.id)!.state, "running"); // the store marks it failed when it next opens
  assert.equal(store.get(b.id)!.state, "queued");
  assert.deepEqual(fake.started(), [a.id]);
});
