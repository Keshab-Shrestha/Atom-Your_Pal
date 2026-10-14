import { test } from "node:test";
import assert from "node:assert/strict";
import { briefFor, createWorkerShortcut, openHelperStore, startJobRunner, waitReason, type HelperStore, type Job, type JobRun, type RunOutcome } from "./index.ts";

// ADR-087, Task 3.8: plan first.

const plan = { summary: "Search three router makers, then compare.", steps: "1. Search\n2. Compare" };
const report = { title: "T", summary: "S.", body: "B", sources: [] };
const tick = () => new Promise((r) => setTimeout(r, 5));
const hold = (store: HelperStore) => (job: Job) => waitReason(job, store.soul(job.helper).name);

test("a worker's switch makes its new tasks plan first; a task can say otherwise", () => {
  const store = openHelperStore({ path: ":memory:" });
  assert.equal(store.addJob("sid", "a").planFirst, false);
  store.setPlanFirst("sid", true);
  assert.equal(store.list()[0]!.planFirst, true);
  assert.equal(store.addJob("sid", "b").planFirst, true);
  assert.equal(store.addJob("sid", "c", { planFirst: false }).planFirst, false);
  assert.equal(store.addJob("penny", "d", { planFirst: true }).planFirst, true);
  assert.equal(store.addGoal("g", [{ helper: "sid", task: "e" }]).tasks[0]!.planFirst, true);
  assert.throws(() => store.setPlanFirst("bob", true), /no helper/);
});

test("a plan-first task stops after planning and waits; an approval runs it with the plan", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const calls: { job: Job; resolve(o: RunOutcome): void }[] = [];
  const run: JobRun = (job) => new Promise((resolve) => calls.push({ job, resolve }));
  const runner = startJobRunner({ store, run });
  const { id } = store.addJob("sid", "Compare mesh routers", { planFirst: true });
  await tick();
  calls[0]!.resolve({ plan });
  await tick();
  const waiting = store.get(id)!;
  assert.deepEqual([waiting.state, waiting.planStatus, waiting.planSummary], ["queued", "awaiting", plan.summary]);
  assert.equal(hold(store)(waiting), "Sid's plan waits for your OK.");
  assert.equal(calls.length, 1, "no run while the plan waits");
  assert.deepEqual(store.thread(id)!.plan, plan);
  assert.equal(store.context(id).plan, undefined, "not handed on before approval");
  store.approvePlan(id);
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.job.planStatus, "approved");
  assert.match(briefFor(calls[1]!.job.task, store.context(id)), /The plan Keshab approved\. Follow it:\n1\. Search\n2\. Compare/);
  calls[1]!.resolve({ report });
  await tick();
  assert.equal(store.get(id)!.state, "done");
  assert.deepEqual(store.thread(id)!.activity.map((a) => a.kind), ["created", "running", "planned", "approved", "running", "done"]);
  assert.throws(() => store.approvePlan(id), /No plan waits/);
  runner.close();
});

test("a rejection ends the task, and what waits for it", () => {
  const store = openHelperStore({ path: ":memory:" });
  const a = store.addJob("sid", "a", { planFirst: true });
  const b = store.addJob("penny", "b", { blockedBy: [a.id] });
  assert.throws(() => store.rejectPlan(a.id), /No plan waits/);
  store.start(a.id);
  store.savePlan(a.id, plan);
  store.rejectPlan(a.id);
  assert.deepEqual([store.get(a.id)!.state, store.get(b.id)!.state], ["stopped", "failed"]);
  assert.deepEqual(store.thread(a.id)!.activity.map((x) => x.kind).slice(-2), ["rejected", "stopped"]);
  assert.throws(() => store.savePlan(b.id, plan), /cannot save a plan/);
});

test("by voice: 'Sid, go ahead' approves the waiting plan, 'Sid, no' rejects it", () => {
  const store = openHelperStore({ path: ":memory:" });
  const say = createWorkerShortcut(store);
  const first = store.addJob("sid", "a", { planFirst: true });
  store.start(first.id);
  store.savePlan(first.id, plan);
  assert.equal(say("Sid, go ahead"), "Sid is starting.");
  assert.equal(store.get(first.id)!.planStatus, "approved");
  const second = store.addJob("sid", "b", { planFirst: true });
  store.start(second.id);
  store.savePlan(second.id, plan);
  assert.equal(say("Sid, go find router prices"), "Sid is on it.", "a new task, not an approval");
  assert.equal(store.get(second.id)!.planStatus, "awaiting");
  assert.equal(say("Sid, no."), "Sid dropped that plan.");
  assert.equal(store.get(second.id)!.state, "stopped");
  assert.equal(say("Sid, yes"), "Sid is on it.", "no plan waits: a new task");
});
