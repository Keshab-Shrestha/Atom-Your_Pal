import { test } from "node:test";
import assert from "node:assert/strict";
import { followUpBrief, handOffTool, openHelperStore, startJobRunner, type Job, type JobRun, type RunOutcome } from "./index.ts";

// ADR-087, Task 3.10: hand-offs.

const report = (title: string) => ({ title, summary: `${title}.`, body: `${title} body.`, sources: [] });
const tick = () => new Promise((r) => setTimeout(r, 5));

test("Sid hands Penny a costs question; Sid finishes this run, waits for Penny, then runs again with her report", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const calls: { job: Job; resolve(o: RunOutcome): void }[] = [];
  const run: JobRun = (job) => new Promise((resolve) => calls.push({ job, resolve }));
  const runner = startJobRunner({ store, run });
  const sid = store.addJob("sid", "Research home mesh Wi-Fi");
  await tick();
  const tool = handOffTool(store, store.get(sid.id)!)!;
  assert.match(tool.description, /Quill \(documenter\), Penny \(financial adviser\), Hana \(hr\)/);
  assert.match(await tool.run({ worker: "penny", task: "What do the top three mesh kits cost?" }), /^Task 2 is with Penny\./);
  const penny = store.get(2)!;
  assert.deepEqual([penny.parentId, store.thread(sid.id)!.handOffs, store.get(sid.id)!.blockedBy], [sid.id, [2], [2]]);
  calls[0]!.resolve({ report: report("Mesh, first pass") });
  await tick();
  assert.deepEqual([store.get(sid.id)!.state, store.get(sid.id)!.waitingFor], ["queued", [2]], "the parent waits for Penny");
  assert.deepEqual(calls.map((c) => c.job.id), [sid.id, 2]);
  calls[1]!.resolve({ report: report("Costs") });
  await tick();
  assert.deepEqual(calls.map((c) => c.job.id), [sid.id, 2, sid.id], "then Sid runs again");
  assert.match(followUpBrief([], store.handOffs(sid.id)), /--- Penny, "What do the top three mesh kits cost\?": Costs\nCosts\.\nCosts body\./);
  assert.ok(store.thread(sid.id)!.activity.some((a) => a.kind === "handed"));
  runner.close();
});

test("a third level, a fourth sub-task, a role that may not take it, and itself are refused", () => {
  const store = openHelperStore({ path: ":memory:" });
  const sid = store.addJob("sid", "Research");
  assert.throws(() => store.handOff(sid.id, "penny", "x"), /Only a running task/);
  store.start(sid.id);
  const penny = store.handOff(sid.id, "penny", "Costs");
  store.start(penny.id);
  assert.throws(() => store.handOff(penny.id, "sid", "deeper"), /A sub-task cannot hand off work again/);
  assert.equal(handOffTool(store, store.get(penny.id)!), undefined, "a sub-task gets no hand_off tool");
  assert.throws(() => store.handOff(sid.id, "sid", "x"), /cannot hand a task to itself/);
  assert.throws(() => store.handOff(sid.id, "tinker", "x"), /Tinker only reviews tasks you rate as not good/);
  store.handOff(sid.id, "hana", "a");
  store.handOff(sid.id, "quill", "b");
  assert.throws(() => store.handOff(sid.id, "hana", "c"), /at most 3 sub-tasks/);
  const quill = store.addJob("quill", "Write");
  store.start(quill.id);
  assert.throws(() => store.handOff(quill.id, "penny", "x"), /Quill cannot hand work to Penny \(financial adviser\)/);
});

test("a sub-task that fails does not fail its parent: the parent runs again without it", () => {
  const store = openHelperStore({ path: ":memory:" });
  const sid = store.addJob("sid", "Research");
  store.start(sid.id);
  const penny = store.handOff(sid.id, "penny", "Costs");
  store.finish(sid.id, report("First"));
  assert.equal(store.get(sid.id)!.state, "queued");
  store.start(penny.id);
  store.fail(penny.id, "No prices found");
  const parent = store.get(sid.id)!;
  assert.deepEqual([parent.state, parent.waitingFor], ["queued", []]);
  assert.deepEqual(store.handOffs(sid.id), [{ worker: "Penny", task: "Costs", error: "No prices found" }]);
  assert.match(followUpBrief([], store.handOffs(sid.id)), /Penny, "Costs": did not finish \(No prices found\)/);
});

test("a sub-task joins its parent's goal, so the goal waits for it", () => {
  const store = openHelperStore({ path: ":memory:" });
  const goal = store.addGoal("mesh guide", [{ helper: "sid", task: "Research" }]);
  store.start(goal.tasks[0]!.id);
  const penny = store.handOff(goal.tasks[0]!.id, "penny", "Costs");
  assert.equal(penny.goalId, goal.id);
  assert.equal(store.goal(goal.id)!.tasks.length, 2);
});
