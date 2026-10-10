import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkerShortcut, followUpBrief, isFollowUp, openHelperStore, startJobRunner, watchGoals, type Job, type JobRun, type RunOutcome } from "./index.ts";

// ADR-087, Task 3.6: wake-ups and memory across runs.

const report = (title: string) => ({ title, summary: `${title}.`, body: `${title} body.`, sources: [] });
const tick = () => new Promise((r) => setTimeout(r, 5));

test("a note on an ended task runs it again, resuming its session with only the new notes", () => {
  const store = openHelperStore({ path: ":memory:" });
  const { id } = store.addJob("sid", "Research IPv6");
  store.addComment(id, "Home routers only");
  store.start(id);
  assert.equal(store.resumeOf(id), undefined, "a first run starts fresh");
  store.setSession(id, "s-1");
  store.finish(id, report("IPv6"));
  assert.equal(store.get(id)!.resumable, true);
  store.addComment(id, "Dig deeper on prefix delegation");
  const again = store.get(id)!;
  assert.deepEqual([again.state, again.endedAt, again.error], ["queued", undefined, undefined]);
  store.start(id);
  assert.deepEqual(store.resumeOf(id), { sessionId: "s-1", notes: ["Dig deeper on prefix delegation"] });
  assert.deepEqual(store.thread(id)!.activity.map((a) => a.kind), ["created", "commented", "running", "done", "commented", "woken", "running"]);
  assert.equal(store.thread(id)!.report?.title, "IPv6", "the last report stays until the new one");
});

test("notes during a run make exactly one more run, which sees all of them", () => {
  const store = openHelperStore({ path: ":memory:" });
  const { id } = store.addJob("sid", "Research");
  store.start(id);
  store.setSession(id, "s-1");
  for (const note of ["a", "b", "c"]) store.addComment(id, note);
  assert.equal(store.get(id)!.wakePending, true);
  assert.equal(store.get(id)!.state, "running", "the run goes on");
  store.finish(id, report("R"));
  assert.deepEqual([store.get(id)!.state, store.get(id)!.wakePending], ["queued", false]);
  store.start(id);
  assert.deepEqual(store.resumeOf(id)?.notes, ["a", "b", "c"]);
  store.finish(id, report("R2"));
  assert.equal(store.get(id)!.state, "done", "no second extra run");
});

test("a failed run asked again runs once more instead of failing what waits for it; a stop drops the wake", () => {
  const store = openHelperStore({ path: ":memory:" });
  const a = store.addJob("sid", "a");
  const b = store.addJob("penny", "b", { blockedBy: [a.id] });
  store.start(a.id);
  store.addComment(a.id, "try again");
  store.fail(a.id, "boom");
  assert.deepEqual([store.get(a.id)!.state, store.get(b.id)!.state], ["queued", "queued"]);
  store.start(a.id);
  store.addComment(a.id, "x");
  store.stop(a.id);
  assert.deepEqual([store.get(a.id)!.state, store.get(a.id)!.wakePending], ["stopped", false]);
});

test("Start fresh forgets the session and runs an ended task again; a running one is refused", () => {
  const store = openHelperStore({ path: ":memory:" });
  const { id } = store.addJob("sid", "x");
  store.start(id);
  assert.throws(() => store.startFresh(id), /Wait for the run to end/);
  store.setSession(id, "s-1");
  store.finish(id, report("X"));
  store.startFresh(id);
  assert.deepEqual([store.get(id)!.state, store.get(id)!.resumable], ["queued", false]);
  assert.equal(store.resumeOf(id), undefined);
  assert.deepEqual(store.thread(id)!.activity.map((a) => a.kind).slice(-2), ["fresh", "woken"]);
});

test("a woken task opens its goal again, which ends again with a new line", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const lines: (string | undefined)[] = [];
  watchGoals({ store, write: async () => "", onEnded: (e) => lines.push(e.line) });
  const goal = store.addGoal("Research mesh", [{ helper: "sid", task: "Research mesh" }]);
  const [task] = goal.tasks;
  store.start(task!.id);
  store.finish(task!.id, report("Mesh"));
  await tick();
  store.addComment(task!.id, "dig deeper");
  assert.equal(store.goal(goal.id)!.endedAt, undefined);
  store.start(task!.id);
  store.finish(task!.id, report("Mesh 2"));
  await tick();
  assert.deepEqual(lines, ["Sid is done. The Helpers window has the report.", "Sid is done. The Helpers window has the report."]);
  assert.equal(store.goal(goal.id)!.report?.title, "Mesh 2");
});

test("the runner runs a woken task once more, even when woken three times during a run", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const calls: { job: Job; resolve(o: RunOutcome): void }[] = [];
  const run: JobRun = (job) => new Promise((resolve) => calls.push({ job, resolve }));
  const runner = startJobRunner({ store, run });
  const { id } = store.addJob("sid", "x");
  await tick();
  for (const note of ["1", "2", "3"]) store.addComment(id, note);
  calls[0]!.resolve({ report: report("A") });
  await tick();
  assert.equal(calls.length, 2);
  calls[1]!.resolve({ report: report("B") });
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(store.get(id)!.state, "done");
  runner.close();
});

test("'Sid, dig deeper on that' is a note on Sid's newest task; with no task it is a new one", () => {
  const store = openHelperStore({ path: ":memory:" });
  const say = createWorkerShortcut(store);
  assert.equal(say("Sid, dig deeper on that"), "Sid is on it.", "nothing to go on with: a new task");
  const [first] = store.list()[0]!.jobs;
  store.start(first!.id);
  assert.equal(say("Sid, also cover IPv6"), "Sid will look again when this run ends.");
  store.finish(first!.id, report("R"));
  assert.equal(store.get(first!.id)!.state, "queued", "woken by the note");
  store.start(first!.id);
  store.finish(first!.id, report("R2"));
  assert.equal(say("Sid, keep going"), "Sid will look again.");
  assert.equal(store.list()[0]!.jobs.length, 1);
});

test("follow-up words and the resumed brief", () => {
  for (const t of ["dig deeper on that", "also cover IPv6", "Keep going", "look again", "summarise it", "now go further"]) assert.ok(isFollowUp(t), t);
  for (const t of ["research mesh Wi-Fi", "find router prices", "compare itineraries"]) assert.ok(!isFollowUp(t), t);
  assert.match(followUpBrief(["Dig deeper"]), /^Keshab asks again about this job:\n- Dig deeper\n\nContinue from where you left off/);
  assert.match(followUpBrief([]), /^Keshab asks you to look at this job again\./);
});
