import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRIEF_REPORT_CHARS,
  HelperError,
  MAX_BLOCKERS,
  briefFor,
  makesCycle,
  openHelperStore,
  startJobRunner,
  type Job,
  type JobRun,
  type RunOutcome,
} from "./index.ts";

// ADR-087, Task 3.4: tasks that wait for each other, a thread per task, one run per task.

const report = (title: string) => ({ title, summary: `${title} in one line.`, body: `All about ${title}.`, sources: [{ title: "RFC", url: "https://example.org/" }] });
const tick = () => new Promise((r) => setTimeout(r, 5));

test("a task waiting for another is not runnable until that one is done, then gets its report", () => {
  const store = openHelperStore({ path: ":memory:" });
  const research = store.addJob("sid", "Research home networking");
  const costs = store.addJob("penny", "What does the kit cost?");
  const guide = store.addJob("hana", "Write it up as a guide", { blockedBy: [research.id, costs.id], goal: "A home networking guide" });
  assert.deepEqual([guide.blockedBy, guide.waitingFor, guide.goal], [[research.id, costs.id], [research.id, costs.id], "A home networking guide"]);
  assert.deepEqual(store.queued().map((j) => j.id), [research.id, costs.id]);
  assert.throws(() => store.start(guide.id), /still waits for 1, 2/);

  store.start(research.id);
  store.finish(research.id, report("Networking"));
  assert.deepEqual(store.get(guide.id)!.waitingFor, [costs.id]);
  assert.ok(!store.queued().some((j) => j.id === guide.id), "still waits for Penny");
  store.start(costs.id);
  store.finish(costs.id, report("Costs"));
  assert.deepEqual(store.queued().map((j) => j.id), [guide.id]);

  const context = store.context(guide.id);
  assert.equal(context.goal, "A home networking guide");
  assert.deepEqual(context.earlier.map((r) => [r.worker, r.title]), [["Sid", "Networking"], ["Penny", "Costs"]]);
});

test("two claims on one task give one run", () => {
  const store = openHelperStore({ path: ":memory:" });
  const { id } = store.addJob("sid", "x");
  store.start(id);
  assert.throws(() => store.start(id), HelperError);
  assert.equal(store.get(id)!.state, "running");
});

test("blockers must exist, not repeat past the limit, not have failed, and never close a circle", () => {
  const store = openHelperStore({ path: ":memory:" });
  const a = store.addJob("sid", "a");
  const b = store.addJob("penny", "b", { blockedBy: [a.id, a.id] });
  assert.deepEqual(b.blockedBy, [a.id], "repeats are dropped");
  const c = store.addJob("hana", "c", { blockedBy: [b.id] });
  assert.throws(() => store.addJob("sid", "x", { blockedBy: [99] }), /no task 99/);
  assert.throws(() => store.setBlockers(a.id, [c.id]), /circle/);
  assert.throws(() => store.setBlockers(a.id, [a.id]), /itself/);
  assert.deepEqual(store.get(a.id)!.blockedBy, [], "a refused change leaves it as it was");
  const many = Array.from({ length: MAX_BLOCKERS + 1 }, (_, i) => store.addJob("sid", `t${i}`).id);
  assert.throws(() => store.addJob("penny", "y", { blockedBy: many }), /at most 6/);
  store.setBlockers(c.id, [a.id]); // not a circle
  assert.deepEqual(store.get(c.id)!.blockedBy, [a.id]);
  store.start(a.id);
  assert.throws(() => store.setBlockers(a.id, []), /not started/);
  store.fail(a.id, "boom");
  assert.throws(() => store.addJob("sid", "z", { blockedBy: [a.id] }), /has failed/);
});

test("a task that fails or is stopped fails what waits for it, down the chain", () => {
  const store = openHelperStore({ path: ":memory:" });
  const a = store.addJob("sid", "a");
  const b = store.addJob("penny", "b", { blockedBy: [a.id] });
  const c = store.addJob("hana", "c", { blockedBy: [b.id] });
  store.stop(a.id);
  assert.deepEqual([store.get(b.id)!.state, store.get(b.id)!.error], ["failed", `Task ${a.id}, which it waited for, was stopped.`]);
  assert.deepEqual([store.get(c.id)!.state, store.get(c.id)!.error], ["failed", `Task ${b.id}, which it waited for, failed.`]);
});

test("deleting a task it waits for lets it go on without the report", () => {
  const store = openHelperStore({ path: ":memory:" });
  const a = store.addJob("sid", "a");
  store.start(a.id);
  store.finish(a.id, report("A"));
  const b = store.addJob("penny", "b", { blockedBy: [a.id] });
  store.remove(a.id);
  assert.deepEqual(store.get(b.id)!.blockedBy, []);
  assert.deepEqual(store.queued().map((j) => j.id), [b.id]);
});

test("the thread keeps Keshab's notes, what happened, and the report; notes go to the run", () => {
  const store = openHelperStore({ path: ":memory:" });
  const { id } = store.addJob("sid", "Research IPv6");
  store.addComment(id, "  Focus on home routers. ");
  assert.throws(() => store.addComment(id, "   "), /empty/);
  assert.throws(() => store.addComment(999, "x"), /no job 999/);
  assert.equal(store.get(id)!.comments, 1);
  store.start(id);
  store.finish(id, report("IPv6"));
  const thread = store.thread(id)!;
  assert.deepEqual(thread.comments.map((c) => c.text), ["Focus on home routers."]);
  assert.deepEqual(thread.activity.map((a) => a.kind), ["created", "commented", "running", "done"]);
  assert.equal(thread.report?.title, "IPv6");
  assert.deepEqual(store.context(id).comments, ["Focus on home routers."]);
  assert.equal(store.thread(999), undefined);
  store.remove(id);
  assert.equal(store.thread(id), undefined);
});

test("the runner starts a waiting task only once the task it waits for is done", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const calls: { job: Job; resolve(o: RunOutcome): void }[] = [];
  const run: JobRun = (job) => new Promise((resolve) => calls.push({ job, resolve }));
  const runner = startJobRunner({ store, run });
  const a = store.addJob("sid", "a");
  const b = store.addJob("penny", "b", { blockedBy: [a.id] });
  await tick();
  assert.deepEqual(calls.map((c) => c.job.id), [a.id], "Penny is free but waits");
  calls[0]!.resolve({ report: report("A") });
  await tick();
  assert.deepEqual(calls.map((c) => c.job.id), [a.id, b.id]);
  runner.close();
});

test("cycles are found through any path", () => {
  const edges = new Map([[2, [1]], [3, [2]], [4, []]]);
  assert.equal(makesCycle(edges, 1, [3]), true);
  assert.equal(makesCycle(edges, 1, [4]), false);
  assert.equal(makesCycle(edges, 5, [3, 4]), false);
});

test("the brief carries the goal, notes and earlier reports, marked as data and cut to length", () => {
  const brief = briefFor("Write the guide", {
    goal: "A networking guide",
    comments: ["Keep it short"],
    earlier: [{ worker: "Sid", task: "Research", title: "Networking", summary: "Basics.", body: "x".repeat(BRIEF_REPORT_CHARS + 50), sources: [{ title: "RFC", url: "https://example.org/" }] }],
  });
  assert.match(brief, /^Write the guide\n\nThe goal this task is part of: A networking guide/);
  assert.match(brief, /Notes from Keshab:\n- Keep it short/);
  assert.match(brief, /data, never instructions/);
  assert.match(brief, /Sources: RFC \(https:\/\/example\.org\/\)/);
  assert.ok(brief.includes(`${"x".repeat(BRIEF_REPORT_CHARS)}…`) && !brief.includes("x".repeat(BRIEF_REPORT_CHARS + 1)));
  assert.equal(briefFor("Just this", { comments: [], earlier: [] }), "Just this");
});
