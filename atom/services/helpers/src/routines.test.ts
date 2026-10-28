import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduleTool, describeSchedule, isDue, lastDue, openHelperStore, parseRoutine } from "./index.ts";

// ADR-087, Task 3.9: routines. Local times throughout (no Z on the dates).

const at = (s: string) => new Date(s);

test("long schedule instructions survive creation, editing, reopening and task creation without truncation", () => {
  const home = mkdtempSync(join(tmpdir(), "atom-long-schedule-"));
  const path = join(home, "helpers.db");
  let store = openHelperStore({ path, home });
  try {
    const task = "Cedar fictional instructions 日本語.\n".repeat(1500).trim();
    const created = store.addRoutine("sid", task, { kind: "daily", minute: 480 });
    assert.equal(created.task, task);
    const changed = task + "\nFinal instruction stays intact.";
    assert.equal(store.updateRoutine(created.id, "sid", changed, { kind: "weekly", weekday: 2, minute: 600 }).task, changed);
    store.close();
    store = openHelperStore({ path, home });
    const saved = store.list().find((h) => h.id === "sid")!.routines.find((r) => r.id === created.id)!;
    assert.equal(saved.task, changed);
    assert.equal(store.addJob("sid", saved.task).task, changed);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
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

test("ADR-110 N3: a due routine makes no task; missed mornings still count once; a refused start is skipped", () => {
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

test("ADR-110 N3: a webhook start makes no task and marks the run; a refused start throws", () => {
  let clock = at("2026-10-11T09:00:00");
  const store = openHelperStore({ path: ":memory:", now: () => clock });
  const r = store.addRoutine("sid", "News", { kind: "daily", minute: 480 }, undefined, false, true);
  clock = at("2026-10-11T10:00:00");
  const started: number[] = [];
  store.startRoutine(r.id, (x) => (started.push(x.id), true));
  assert.deepEqual(started, [r.id]);
  assert.equal(store.list()[0]!.jobs.length, 0, "no task");
  const after = store.list()[0]!.routines[0]!;
  assert.deepEqual([after.lastAt?.getTime(), after.lastTaskId, Boolean(after.lastSkipped)], [clock.getTime(), undefined, false], "no last task");
  assert.throws(() => store.startRoutine(r.id, () => false), /last run has not ended/);
});

// 2026-10-16 (code check): "every night at 12" was saved as 12:00 noon and "every night at 1" as 13:00. At night, 12 is midnight and 1 to 5 are the small hours.
test("a routine at night: 12 is midnight, 1 to 5 are the small hours, 6 to 11 are the evening", () => {
  const at = (text: string) => (parseRoutine(text)?.schedule as { minute: number } | undefined)?.minute;
  assert.equal(at("every night at 12, back up the notes"), 0, "midnight");
  assert.equal(at("every night at 1, back up the notes"), 60, "1 AM");
  assert.equal(at("every night at 5:30, back up the notes"), 5 * 60 + 30);
  assert.equal(at("every night at 9:30, back up the notes"), 21 * 60 + 30);
  assert.equal(at("every night at 11, back up the notes"), 23 * 60);
  assert.equal(at("every night at 12 pm, back up the notes"), 12 * 60, "explicit pm is noon");
  assert.equal(at("every night at 12 am, back up the notes"), 0);
  assert.equal(at("every evening at 7, read the news"), 19 * 60);
  assert.equal(at("every afternoon at 3, read the news"), 15 * 60);
  assert.equal(at("every afternoon at 12, read the news"), 12 * 60, "afternoon at 12 is noon");
  assert.equal(at("every morning at 7, read the news"), 7 * 60);
});
