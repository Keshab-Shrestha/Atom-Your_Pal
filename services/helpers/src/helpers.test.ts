import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLOSED_WHILE_RUNNING,
  HelperError,
  MAX_TASK_CHARS,
  canMove,
  move,
  openHelperStore,
  webSources,
  type HelperChange,
  type JobState,
} from "./index.ts";

function clock() {
  let t = Date.parse("2026-10-10T09:00:00Z");
  return () => new Date((t += 60_000));
}

const report = {
  title: "Networking",
  summary: "The basics of networking.",
  body: "One.\n\nTwo.",
  sources: [
    { title: "MDN", url: "https://developer.mozilla.org/" },
    { title: "Old", url: "http://example.com/" },
    { title: "Bad", url: "javascript:alert(1)" },
    { title: "File", url: "file:///etc/passwd" },
    { title: "Junk", url: "not a url" },
  ],
};

// --- state machine ---

test("a job moves queued → running → done|failed|stopped, and queued → stopped; final states never move", () => {
  const all: JobState[] = ["queued", "running", "done", "failed", "stopped"];
  const allowed = new Set(["queued>running", "queued>stopped", "running>done", "running>failed", "running>stopped"]);
  for (const from of all) {
    for (const to of all) {
      const ok = allowed.has(`${from}>${to}`);
      assert.equal(canMove(from, to), ok, `${from} → ${to}`);
      if (ok) assert.equal(move(from, to), to);
      else assert.throws(() => move(from, to), HelperError);
    }
  }
});

test("webSources keeps http and https addresses only", () => {
  assert.deepEqual(webSources(report.sources).map((s) => s.title), ["MDN", "Old"]);
});

// --- store ---

test("lists the three helpers in a fixed order, Sid available, Kame and Puff not yet", () => {
  const store = openHelperStore({ path: ":memory:" });
  assert.deepEqual(
    store.list().map((h) => [h.id, h.name, h.available, h.app, h.jobs.length]),
    [
      ["sid", "Sid", true, null, 0],
      ["kame", "Kame", false, null, 0],
      ["puff", "Puff", false, null, 0],
    ],
  );
});

test("setApp gives a helper its app, \"\" clears it, an unknown helper is refused", () => {
  const store = openHelperStore({ path: ":memory:" });
  store.setApp("sid", "Brave Browser");
  assert.equal(store.list()[0]!.app, "Brave Browser");
  store.setApp("sid", "");
  assert.equal(store.list()[0]!.app, null);
  assert.throws(() => store.setApp("bob", "Notes"), HelperError);
});

test("addJob trims, queues, and refuses an unknown or unavailable helper and an empty or long task", () => {
  const store = openHelperStore({ path: ":memory:", now: clock() });
  const job = store.addJob("sid", "  research networking \n");
  assert.equal(job.task, "research networking");
  assert.equal(job.state, "queued");
  assert.equal(job.partial, false);
  assert.equal(job.createdAt.toISOString(), "2026-10-10T09:02:00.000Z");
  assert.equal(job.endedAt, undefined);
  assert.throws(() => store.addJob("bob", "x"), /no helper/);
  assert.throws(() => store.addJob("kame", "x"), /not ready/);
  assert.throws(() => store.addJob("sid", "   "), /empty/);
  assert.throws(() => store.addJob("sid", "x".repeat(MAX_TASK_CHARS + 1)), /too long/);
  store.addJob("sid", "x".repeat(MAX_TASK_CHARS)); // exactly the limit is fine
  assert.equal(store.list()[0]!.jobs.length, 2);
});

test("list shows the newest 20 jobs per helper, newest first", () => {
  const store = openHelperStore({ path: ":memory:" });
  for (let i = 1; i <= 25; i++) store.addJob("sid", `job ${i}`);
  const jobs = store.list()[0]!.jobs;
  assert.equal(jobs.length, 20);
  assert.equal(jobs[0]!.task, "job 25");
  assert.equal(jobs.at(-1)!.task, "job 6");
});

test("a run: start, step, finish with a report; the report keeps web sources only and shows its title in the list", () => {
  const store = openHelperStore({ path: ":memory:", now: clock() });
  const { id } = store.addJob("sid", "research networking");
  assert.equal(store.step(id, "Searching"), false, "a queued job has no step");
  store.start(id);
  assert.equal(store.step(id, "Reading 3 of 8 pages"), true);
  assert.equal(store.get(id)!.step, "Reading 3 of 8 pages");
  store.finish(id, report, true);
  const job = store.get(id)!;
  assert.deepEqual([job.state, job.partial, job.step, job.title, job.summary], ["done", true, undefined, "Networking", "The basics of networking."]);
  assert.ok(job.endedAt);
  assert.equal(store.list()[0]!.jobs[0]!.title, "Networking");
  const saved = store.report(id)!;
  assert.equal(saved.body, "One.\n\nTwo.");
  assert.deepEqual(saved.sources, [
    { title: "MDN", url: "https://developer.mozilla.org/" },
    { title: "Old", url: "http://example.com/" },
  ]);
  assert.equal(store.step(id, "late"), false, "a finished job takes no steps");
});

test("illegal moves are refused and change nothing", () => {
  const store = openHelperStore({ path: ":memory:" });
  const { id } = store.addJob("sid", "a");
  assert.throws(() => store.finish(id, report), HelperError, "a queued job cannot be done");
  assert.equal(store.report(id), undefined, "no report is written for a refused finish");
  assert.throws(() => store.fail(id, "x"), HelperError);
  store.start(id);
  assert.throws(() => store.start(id), HelperError);
  store.fail(id, "The page limit was reached");
  assert.deepEqual([store.get(id)!.state, store.get(id)!.error], ["failed", "The page limit was reached"]);
  assert.throws(() => store.finish(id, report), HelperError);
  assert.throws(() => store.start(999), /no job 999/);
});

test("stop ends a queued or running job; an unknown or finished job is ignored", () => {
  const store = openHelperStore({ path: ":memory:" });
  const a = store.addJob("sid", "a").id;
  const b = store.addJob("sid", "b").id;
  store.start(b);
  assert.equal(store.stop(a), true);
  assert.equal(store.stop(b), true);
  assert.deepEqual([store.get(a)!.state, store.get(b)!.state], ["stopped", "stopped"]);
  assert.ok(store.get(a)!.endedAt);
  assert.equal(store.stop(a), false);
  assert.equal(store.stop(999), false);
});

test("remove deletes the job and its report, stopping a running job first", () => {
  const store = openHelperStore({ path: ":memory:" });
  const changes: HelperChange[] = [];
  store.onChange((c) => changes.push(c));
  const done = store.addJob("sid", "a").id;
  store.start(done);
  store.finish(done, report);
  const running = store.addJob("sid", "b").id;
  store.start(running);
  changes.length = 0;
  assert.equal(store.remove(done), true);
  assert.equal(store.report(done), undefined);
  assert.equal(store.get(done), undefined);
  assert.equal(store.remove(running), true);
  assert.deepEqual(
    changes.map((c) => [c.action, "job" in c ? c.job : undefined, "state" in c ? c.state : undefined]),
    [
      ["deleted", done, undefined],
      ["job", running, "stopped"],
      ["deleted", running, undefined],
    ],
  );
  assert.equal(store.remove(999), false);
  assert.deepEqual(store.list()[0]!.jobs, []);
});

test("change events carry ids, states and timings, never task or report text", () => {
  const store = openHelperStore({ path: ":memory:", now: clock() });
  const changes: HelperChange[] = [];
  const stop = store.onChange((c) => changes.push(c));
  store.setApp("sid", "Brave Browser");
  const { id } = store.addJob("sid", "secret plans");
  store.start(id);
  store.step(id, "Searching");
  store.finish(id, report);
  assert.deepEqual(changes, [
    { action: "app", helper: "sid" },
    { action: "job", helper: "sid", job: id, state: "queued" },
    { action: "job", helper: "sid", job: id, state: "running" },
    { action: "step", helper: "sid", job: id },
    { action: "job", helper: "sid", job: id, state: "done", ms: 60_000 },
  ]);
  stop();
  store.addJob("sid", "more");
  assert.equal(changes.length, 5, "an unsubscribed listener hears nothing");
});

test("survives a restart: the app, jobs and reports are kept; a job left running becomes failed", () => {
  const dir = mkdtempSync(join(tmpdir(), "zeno-helpers-"));
  try {
    const path = join(dir, "nested", "helpers.db");
    const first = openHelperStore({ path });
    first.setApp("sid", "Brave Browser");
    const done = first.addJob("sid", "a").id;
    first.start(done);
    first.finish(done, report);
    const running = first.addJob("sid", "b").id;
    first.start(running);
    const queued = first.addJob("sid", "c").id;
    first.close();

    const second = openHelperStore({ path });
    assert.equal(second.list()[0]!.app, "Brave Browser");
    assert.equal(second.report(done)!.title, "Networking");
    const r = second.get(running)!;
    assert.deepEqual([r.state, r.error], ["failed", CLOSED_WHILE_RUNNING]);
    assert.ok(r.endedAt);
    assert.equal(second.get(queued)!.state, "queued", "queued jobs wait for the runner");
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
