import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PLAN_LIMIT, DEFAULT_TEAM_CAP, DEFAULT_WORKER_CAP, holdFor, isOver, openHelperStore, startJobRunner, type HelperStore, type Job, type JobRun, type RunOutcome } from "./index.ts";

// ADR-087, Task 3.7: budgets.

const report = { title: "T", summary: "S.", body: "B", sources: [] };
const tick = () => new Promise((r) => setTimeout(r, 5));
const held = (store: HelperStore, planUsed?: number) => (job: Job) => holdFor(job, store.budgets(), store.soul(job.helper).name, planUsed);

test("spend counts per worker and for the team, for today only", () => {
  let clock = new Date("2026-10-11T23:00:00");
  const store = openHelperStore({ path: ":memory:", now: () => clock });
  const a = store.addJob("sid", "a");
  const b = store.addJob("penny", "b");
  store.addSpend(a.id, 1.25);
  store.addSpend(a.id, 0.5);
  store.addSpend(b.id, 2);
  store.addSpend(b.id, -1); // ignored
  store.addSpend(99, 3); // no such task: ignored
  let budgets = store.budgets();
  assert.deepEqual([budgets.workers.sid, budgets.workers.penny, budgets.team, budgets.planLimit], [
    { cap: DEFAULT_WORKER_CAP, spent: 1.75 },
    { cap: DEFAULT_WORKER_CAP, spent: 2 },
    { cap: DEFAULT_TEAM_CAP, spent: 3.75 },
    DEFAULT_PLAN_LIMIT,
  ]);
  assert.deepEqual(store.list()[0]!.budget, { cap: DEFAULT_WORKER_CAP, spent: 1.75 });
  clock = new Date("2026-10-12T00:30:00");
  budgets = store.budgets();
  assert.deepEqual([budgets.workers.sid!.spent, budgets.team.spent], [0, 0], "a new day starts at zero");
});

test("caps are set per worker and for the team, can be removed, and are checked", () => {
  const store = openHelperStore({ path: ":memory:" });
  store.setBudget("sid", 2.5);
  store.setBudget("team", null);
  store.setPlanLimit(60);
  const budgets = store.budgets();
  assert.deepEqual([budgets.workers.sid!.cap, budgets.team.cap, budgets.planLimit], [2.5, null, 60]);
  assert.throws(() => store.setBudget("sid", 0), /more than \$0/);
  assert.throws(() => store.setBudget("sid", 5000), /at most \$1000/);
  assert.throws(() => store.setBudget("bob", 1), /no helper/);
  assert.throws(() => store.setPlanLimit(5), /10 to 100/);
  assert.throws(() => store.setPlanLimit(55.5), /whole percent/);
});

test("a runnable task is held when its worker's or the team's budget is used up, or the plan is above its limit", () => {
  const store = openHelperStore({ path: ":memory:" });
  const a = store.addJob("sid", "a");
  const waiting = store.addJob("penny", "w", { blockedBy: [a.id] });
  const hold = held(store);
  assert.equal(hold(a), undefined);
  store.setBudget("sid", 1);
  store.addSpend(a.id, 0.85);
  assert.ok(!isOver(store.budgets().workers.sid!), "not over at 85 %");
  store.addSpend(a.id, 0.15);
  assert.equal(hold(store.get(a.id)!), "Sid's daily budget ($1.00) is used up.");
  assert.equal(hold(store.get(waiting.id)!), undefined, "a task still waiting is not held: it waits anyway");
  const b = store.addJob("hana", "b");
  store.setBudget("team", 1);
  assert.equal(hold(b), "The team's daily budget ($1.00) is used up.");
  store.setBudget("team", null);
  assert.equal(held(store, 85)(b), "The Claude plan is 85% used; new runs wait below 80%.");
  assert.equal(held(store, 79)(b), undefined);
  store.setPlanLimit(100);
  assert.equal(held(store, 99)(b), undefined, "100 % means never wait for the plan");
});

test("a worker over its cap pauses with no new run; raising the cap resumes it", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const calls: { job: Job; resolve(o: RunOutcome): void }[] = [];
  const run: JobRun = (job) => new Promise((resolve) => calls.push({ job, resolve }));
  const runner = startJobRunner({ store, run, mayStart: (job) => !held(store)(job) });
  store.setBudget("sid", 1);
  const first = store.addJob("sid", "first");
  await tick();
  store.addSpend(first.id, 1.2); // the run reports its cost
  calls[0]!.resolve({ report });
  const second = store.addJob("sid", "second");
  await tick();
  assert.equal(calls.length, 1, "no new run");
  assert.equal(store.get(second.id)!.state, "queued");
  store.setBudget("sid", 5);
  await tick();
  assert.deepEqual(calls.map((c) => c.job.id), [first.id, second.id]);
  runner.close();
});

test("poke looks again when something outside the store changed", async () => {
  const store = openHelperStore({ path: ":memory:" });
  let allowed = false;
  const calls: number[] = [];
  const runner = startJobRunner({ store, run: (job) => (calls.push(job.id), new Promise(() => {})), mayStart: () => allowed });
  store.addJob("sid", "x");
  await tick();
  assert.deepEqual(calls, []);
  allowed = true;
  runner.poke();
  await tick();
  assert.deepEqual(calls, [1]);
  runner.close();
});
