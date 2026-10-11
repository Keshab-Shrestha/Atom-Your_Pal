import { test } from "node:test";
import assert from "node:assert/strict";
import { createTeamTaskTool, describeWake, isDue, nextDue, openHelperStore } from "./index.ts";

// ADR-094 part B: team tasks, wake-ups, paused routines. Local times (no Z on the dates).

const at = (s: string) => new Date(s);
const MIN = 60_000;

function fixture(start = "2026-10-12T09:00:00") {
  let clock = at(start);
  const store = openHelperStore({ path: ":memory:", now: () => clock });
  return { store, later: (minutes: number) => (clock = new Date(clock.getTime() + minutes * MIN)), now: () => clock };
}

test("a team task waits unassigned; a worker that wakes takes it as its own task", () => {
  const { store, later } = fixture();
  const posted = store.addTeamTask("Find three mesh routers", "researcher");
  assert.deepEqual([posted.task, posted.role], ["Find three mesh routers", "researcher"]);
  assert.equal(store.queued().length, 0, "nobody runs a team task until it is taken");
  store.setWakeUp("sid", "15m");
  assert.deepEqual(store.runWakeUps(), [], "not due yet");
  later(15);
  const [woke] = store.runWakeUps();
  assert.equal(woke!.helper, "sid");
  assert.equal(woke!.teamTask, posted.id);
  const job = store.get(woke!.job!)!;
  assert.deepEqual([job.helper, job.task, job.state], ["sid", "Find three mesh routers", "queued"]);
  assert.deepEqual(store.teamTasks(), []);
});

test("a role limits who may take it; anyone means any worker", () => {
  const { store, later } = fixture();
  const forCoder = store.addTeamTask("Fix the build", "coder");
  store.setWakeUp("sid", "15m");
  later(15);
  assert.deepEqual(store.runWakeUps(), [{ helper: "sid" }], "Sid woke but may not take a coder's task");
  const anyone = store.addTeamTask("Summarise the week", null);
  later(15);
  assert.equal(store.runWakeUps()[0]!.teamTask, anyone.id);
  assert.deepEqual(store.teamTasks().map((t) => t.id), [forCoder.id]);
  assert.throws(() => store.addTeamTask("x", "astronaut"), /No worker is a astronaut/);
  assert.throws(() => store.addTeamTask("x", "improver"), /Tinker/);
  assert.throws(() => store.addTeamTask("   "), /empty/);
});

test("the oldest task first, one per wake", () => {
  const { store, later } = fixture();
  const first = store.addTeamTask("first");
  later(1);
  const second = store.addTeamTask("second");
  store.setWakeUp("sid", "1h");
  later(60);
  assert.equal(store.runWakeUps()[0]!.teamTask, first.id);
  assert.deepEqual(store.teamTasks().map((t) => t.id), [second.id], "one per wake-up");
});

test("two workers waking together never take the same task", () => {
  const { store, later } = fixture();
  store.addTeamTask("only one");
  store.setWakeUp("sid", "15m");
  store.setWakeUp("penny", "15m");
  later(15);
  const woken = store.runWakeUps();
  assert.equal(woken.length, 2);
  assert.equal(woken.filter((w) => w.job !== undefined).length, 1);
  assert.equal(store.list().flatMap((h) => h.jobs).length, 1);
});

test("a busy worker, a used-up budget or the plan above its limit leaves the task waiting", () => {
  const { store, later } = fixture();
  const posted = store.addTeamTask("research");
  store.setWakeUp("sid", "15m");
  const own = store.addJob("sid", "already working");
  store.start(own.id);
  later(15);
  assert.deepEqual(store.runWakeUps(), [{ helper: "sid" }], "running: not idle");
  store.stop(own.id);
  const queued = store.addJob("sid", "next in line");
  later(15);
  assert.deepEqual(store.runWakeUps(), [{ helper: "sid" }], "queued: not idle");
  store.stop(queued.id);
  store.setBudget("sid", 1);
  store.addSpend(own.id, 1);
  later(15);
  assert.deepEqual(store.runWakeUps(), [{ helper: "sid" }], "over its budget");
  store.setBudget("sid", 10);
  store.setPlanLimit(80);
  later(15);
  assert.deepEqual(store.runWakeUps(85), [{ helper: "sid" }], "the plan is above its limit");
  assert.deepEqual(store.teamTasks().map((t) => t.id), [posted.id]);
  later(15);
  assert.equal(store.runWakeUps(50)[0]!.teamTask, posted.id, "below the limit it takes it");
});

test("wake-up times: next one interval on, recorded on each wake, missed wakes count once, pause and resume", () => {
  const { store, later, now } = fixture();
  store.setWakeUp("sid", "4h");
  const wake = () => store.list().find((h) => h.id === "sid")!.wakeUp!;
  assert.deepEqual([wake().every, wake().paused, wake().lastAt], ["4h", false, undefined]);
  assert.equal(wake().nextAt.getTime(), now().getTime() + 240 * MIN);
  later(60 * 24); // closed for a day
  assert.equal(store.runWakeUps().length, 1);
  assert.equal(store.runWakeUps().length, 0, "once, not six times");
  assert.equal(wake().lastAt!.getTime(), now().getTime());
  assert.equal(wake().nextAt.getTime(), now().getTime() + 240 * MIN);
  store.pauseWakeUp("sid", true);
  later(60 * 5);
  assert.equal(store.runWakeUps().length, 0, "paused");
  store.pauseWakeUp("sid", false);
  assert.equal(wake().nextAt.getTime(), now().getTime() + 240 * MIN, "resumed: one interval from now");
  store.setWakeUp("sid", null);
  assert.equal(store.list().find((h) => h.id === "sid")!.wakeUp, undefined);
  assert.throws(() => store.pauseWakeUp("sid", true), /no wake-ups/);
  assert.throws(() => store.setWakeUp("tinker", "1h"), /does not take tasks/);
  assert.throws(() => store.setWakeUp("nobody", "1h"), /no helper/);
  assert.deepEqual(["15m", "1h", "4h", "1d"].map((e) => describeWake(e as "1h")), ["Every 15 minutes", "Every hour", "Every 4 hours", "Every day"]);
});

test("changes carry ids only, never the task", () => {
  const { store, later } = fixture();
  const changes: unknown[] = [];
  store.onChange((c) => changes.push(c));
  store.addTeamTask("secret words");
  store.setWakeUp("sid", "15m");
  later(15);
  store.runWakeUps();
  assert.ok(!JSON.stringify(changes).includes("secret"));
  assert.ok(changes.some((c) => (c as { action: string; change?: string }).action === "team" && (c as { change: string }).change === "taken"));
});

test("a paused routine makes nothing; resumed, it does not make up the missed times", () => {
  const { store, later } = fixture("2026-10-12T07:00:00");
  const r = store.addRoutine("sid", "News", { kind: "daily", minute: 480 });
  store.pauseRoutine(r.id, true);
  later(120); // 9:00, past 8:00
  assert.deepEqual(store.runRoutines(), { made: [], skipped: [] });
  store.pauseRoutine(r.id, false);
  assert.deepEqual(store.runRoutines(), { made: [], skipped: [] }, "8:00 came while paused");
  later(60 * 23); // next day 8:00
  assert.deepEqual(store.runRoutines().made, [r.id]);
  assert.throws(() => store.pauseRoutine(999, true), /no such routine/);
});

test("the next time a routine comes due", () => {
  const created = at("2026-10-12T07:00:00");
  assert.deepEqual(nextDue({ kind: "daily", minute: 480 }, created, at("2026-10-12T07:30:00")), at("2026-10-12T08:00:00"));
  assert.deepEqual(nextDue({ kind: "daily", minute: 480 }, created, at("2026-10-12T08:00:00")), at("2026-10-13T08:00:00"));
  assert.deepEqual(nextDue({ kind: "weekly", weekday: 1, minute: 570 }, created, at("2026-10-12T10:00:00")), at("2026-10-19T09:30:00"), "Monday 12 Oct after 9:30");
  assert.deepEqual(nextDue({ kind: "hours", every: 3 }, created, at("2026-10-12T08:00:00")), at("2026-10-12T10:00:00"));
  assert.ok(!isDue({ schedule: { kind: "hours", every: 1 }, createdAt: created, resumedAt: at("2026-10-12T09:30:00") }, at("2026-10-12T09:45:00")));
});

test("Pal's post_to_team tool posts a team task and says who may take it", () => {
  const { store } = fixture();
  const posted: unknown[] = [];
  const tool = createTeamTaskTool({ store, onPosted: (e) => posted.push(e) });
  assert.match(tool.run({ task: "Compare note apps", role: "anyone" }), /team task 1, for any worker\. No worker that may take it wakes up/);
  store.setWakeUp("sid", "1h");
  assert.match(tool.run({ task: "Find sources", role: "Researcher" }), /team task 2, for a researcher\. Sid wakes up by themselves/);
  assert.deepEqual(store.teamTasks().map((t) => t.role ?? null), [null, "researcher"]);
  assert.deepEqual(posted, [{ teamTask: 1 }, { teamTask: 2 }]);
  assert.throws(() => tool.run({ task: "x", role: "astronaut" }), /No worker is a astronaut/);
});
