import { test } from "node:test";
import assert from "node:assert/strict";
import { briefFor, openHelperStore } from "./index.ts";

// ADR-087, Task 3.8: plan first.

const plan = { summary: "Search three router makers, then compare.", steps: "1. Search\n2. Compare" };
const report = { title: "T", summary: "S.", body: "B", sources: [] };
const tick = () => new Promise((r) => setTimeout(r, 5));

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

