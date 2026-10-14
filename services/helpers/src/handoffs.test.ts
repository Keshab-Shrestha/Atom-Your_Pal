import { test } from "node:test";
import assert from "node:assert/strict";
import { followUpBrief, openHelperStore } from "./index.ts";

// ADR-087, Task 3.10: hand-offs.

const report = (title: string) => ({ title, summary: `${title}.`, body: `${title} body.`, sources: [] });
const tick = () => new Promise((r) => setTimeout(r, 5));

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
