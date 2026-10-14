import { test } from "node:test";
import assert from "node:assert/strict";
import { createScheduleTool, createWorkerShortcut, describeSchedule, isDue, lastDue, openHelperStore, parseRoutine } from "./index.ts";

// ADR-087, Task 3.9: routines. Local times throughout (no Z on the dates).

const at = (s: string) => new Date(s);

test("'Sid, every morning at 8, summarise networking news' makes a routine that makes a task at 8", () => {
  let clock = at("2026-10-11T21:00:00");
  const store = openHelperStore({ path: ":memory:", now: () => clock });
  const say = createWorkerShortcut(store);
  assert.equal(say("Sid, every morning at 8, summarise networking news"), "Sid will do that every day at 8:00 am.");
  const [routine] = store.list()[0]!.routines;
  assert.deepEqual([routine!.task, routine!.schedule], ["summarise networking news", { kind: "daily", minute: 480 }]);
  assert.equal(store.list()[0]!.jobs.length, 0, "no task yet");
  clock = at("2026-10-12T07:59:00");
  assert.deepEqual(store.runRoutines(), { made: [], skipped: [] });
  clock = at("2026-10-12T08:00:30");
  assert.deepEqual(store.runRoutines(), { made: [routine!.id], skipped: [] });
  assert.equal(store.list()[0]!.jobs[0]!.task, "summarise networking news");
  assert.deepEqual(store.runRoutines(), { made: [], skipped: [] }, "once per morning");
});

test("mornings missed while ATOM was closed run once at start", () => {
  let clock = at("2026-10-11T09:00:00");
  const store = openHelperStore({ path: ":memory:", now: () => clock });
  const r = store.addRoutine("sid", "News", { kind: "daily", minute: 480 });
  clock = at("2026-10-14T10:00:00"); // three mornings later
  assert.deepEqual(store.runRoutines().made, [r.id]);
  assert.equal(store.list()[0]!.jobs.length, 1);
  assert.deepEqual(store.runRoutines().made, []);
});

test("a routine whose last task is still going is skipped this time", () => {
  let clock = at("2026-10-11T09:00:00");
  const store = openHelperStore({ path: ":memory:", now: () => clock });
  const r = store.addRoutine("sid", "Check", { kind: "hours", every: 1 });
  clock = at("2026-10-11T10:00:00");
  store.runRoutines();
  const [task] = store.list()[0]!.jobs;
  store.start(task!.id);
  clock = at("2026-10-11T11:00:00");
  assert.deepEqual(store.runRoutines(), { made: [], skipped: [r.id] });
  assert.equal(store.list()[0]!.routines[0]!.lastSkipped, true);
  assert.equal(store.list()[0]!.jobs.length, 1, "no overlapping run");
  store.finish(task!.id, { title: "T", summary: "S.", body: "B", sources: [] });
  clock = at("2026-10-11T12:00:00");
  assert.deepEqual(store.runRoutines().made, [r.id]);
});

test("when a schedule last came due", () => {
  const made = at("2026-10-05T12:00:00"); // a Monday
  assert.deepEqual(lastDue({ kind: "daily", minute: 480 }, made, at("2026-10-11T07:00:00")), at("2026-10-10T08:00:00"));
  assert.deepEqual(lastDue({ kind: "daily", minute: 480 }, made, at("2026-10-11T08:00:00")), at("2026-10-11T08:00:00"));
  // Sunday the 11th: the last Monday 9:30 was the 5th... before the routine was made, so not due.
  assert.deepEqual(lastDue({ kind: "weekly", weekday: 1, minute: 570 }, made, at("2026-10-11T10:00:00")), at("2026-10-05T09:30:00"));
  assert.equal(isDue({ schedule: { kind: "weekly", weekday: 1, minute: 570 }, createdAt: made }, at("2026-10-11T10:00:00")), false);
  assert.equal(isDue({ schedule: { kind: "weekly", weekday: 1, minute: 570 }, createdAt: made }, at("2026-10-12T09:30:00")), true);
  assert.equal(lastDue({ kind: "hours", every: 3 }, made, at("2026-10-05T14:59:00")), undefined);
  assert.deepEqual(lastDue({ kind: "hours", every: 3 }, made, at("2026-10-05T19:00:00")), at("2026-10-05T18:00:00"));
});

test("routine wordings", () => {
  assert.deepEqual(parseRoutine("every morning at 8, summarise networking news"), { schedule: { kind: "daily", minute: 480 }, task: "summarise networking news" });
  assert.deepEqual(parseRoutine("every evening at 7:30 check the weather"), { schedule: { kind: "daily", minute: 1170 }, task: "check the weather" });
  assert.deepEqual(parseRoutine("every Monday at 9 am: review rates"), { schedule: { kind: "weekly", weekday: 1, minute: 540 }, task: "review rates" });
  assert.deepEqual(parseRoutine("daily at 12 am, back up notes"), { schedule: { kind: "daily", minute: 0 }, task: "back up notes" });
  assert.deepEqual(parseRoutine("every 3 hours, check the news"), { schedule: { kind: "hours", every: 3 }, task: "check the news" });
  assert.deepEqual(parseRoutine("every hour check prices"), { schedule: { kind: "hours", every: 1 }, task: "check prices" });
  for (const bad of ["every so often, check", "every morning, check", "every day at 25, check", "every 500 hours, x", "every Monday at 13 pm, x"]) assert.equal(parseRoutine(bad), undefined, bad);
  assert.equal(describeSchedule({ kind: "weekly", weekday: 1, minute: 570 }), "Every Monday at 9:30 AM");
  assert.equal(describeSchedule({ kind: "hours", every: 1 }), "Every hour");
});

test("an 'every …' the code cannot read goes to Pal; a bad routine is refused in words", () => {
  const store = openHelperStore({ path: ":memory:" });
  const say = createWorkerShortcut(store);
  assert.equal(say("Sid, every so often, check the news"), undefined);
  assert.equal(say("Tinker, every day at 8, review the team"), "Tinker only reviews tasks you rate as not good.");
  assert.equal(store.list().flatMap((h) => h.routines).length, 0);
  assert.throws(() => store.addRoutine("sid", "x", { kind: "hours", every: 0 }), /every 1 to 168 hours/);
  assert.equal(store.removeRoutine(99), false);
});

test("the schedule tool reads the model's words and checks them", () => {
  const store = openHelperStore({ path: ":memory:" });
  const scheduled: unknown[] = [];
  const tool = createScheduleTool({ store, onScheduled: (e) => scheduled.push(e) });
  assert.match(tool.run({ worker: "penny", task: "Check mortgage rates", every: "week", weekday: "Monday", time: "09:00" }), /^Routine made: Penny, every monday at 9:00 am\./);
  assert.deepEqual(scheduled, [{ routine: 1, helper: "penny" }]);
  assert.throws(() => tool.run({ worker: "Sid", task: "x", every: "day", time: "8am" }), /HH:MM/);
  assert.throws(() => tool.run({ worker: "Sid", task: "x", every: "month" }), /"day", "week" or "hours"/);
  assert.throws(() => tool.run({ worker: "Sid", task: "x", every: "week", weekday: "funday", time: "08:00" }), /weekday/);
  assert.throws(() => tool.run({ worker: "Bob", task: "x", every: "hours", hours: 2 }), /no worker called "Bob"/);
  assert.ok(store.removeRoutine(1));
  assert.equal(store.list()[4]!.routines.length, 0);
});

test("ADR-110 N3: with a native start a due routine makes no task; missed mornings still count once; a refused start is skipped", () => {
  let clock = at("2026-10-11T09:00:00");
  const store = openHelperStore({ path: ":memory:", now: () => clock });
  const r = store.addRoutine("sid", "News", { kind: "daily", minute: 480 });
  const started: number[] = [];
  clock = at("2026-10-14T10:00:00"); // three mornings later
  assert.deepEqual(store.runRoutines((x) => (started.push(x.id), true)), { made: [r.id], skipped: [] });
  assert.deepEqual(started, [r.id], "one catch-up");
  assert.equal(store.list()[0]!.jobs.length, 0, "no legacy task");
  assert.deepEqual(store.runRoutines(() => true).made, [], "once per morning");
  clock = at("2026-10-15T08:00:30");
  assert.deepEqual(store.runRoutines(() => false), { made: [], skipped: [r.id] }, "its last run still goes");
  assert.equal(store.list()[0]!.routines[0]!.lastSkipped, true);
});

test("ADR-110 N3: a native webhook start makes no task and marks the run; a refused start throws; native runs keep no old last task", () => {
  let clock = at("2026-10-11T09:00:00");
  const store = openHelperStore({ path: ":memory:", now: () => clock });
  const r = store.addRoutine("sid", "News", { kind: "daily", minute: 480 }, undefined, false, true);
  const legacy = store.startRoutine(r.id)!; // a task from the legacy engine (still to do: the native start does not wait for it)
  assert.equal(store.list()[0]!.routines[0]!.lastTaskId, legacy.id);
  clock = at("2026-10-11T10:00:00");
  const started: number[] = [];
  assert.equal(store.startRoutine(r.id, (x) => (started.push(x.id), true)), null);
  assert.deepEqual(started, [r.id]);
  assert.equal(store.list()[0]!.jobs.length, 1, "no new task");
  const after = store.list()[0]!.routines[0]!;
  assert.deepEqual([after.lastAt?.getTime(), after.lastTaskId, Boolean(after.lastSkipped)], [clock.getTime(), undefined, false], "no stale last task");
  assert.throws(() => store.startRoutine(r.id, () => false), /last run has not ended/);
});
