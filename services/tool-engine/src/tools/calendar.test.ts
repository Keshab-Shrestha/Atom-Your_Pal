import { test } from "node:test";
import assert from "node:assert/strict";
import { createCalendarTools, type CalendarRunner } from "./calendar.ts";

const now = () => new Date("2026-10-04T10:00:00+09:00");
function tools(reply: (args: string[]) => Record<string, unknown>) {
  const calls: string[][] = [];
  const run: CalendarRunner = async (args) => {
    calls.push(args);
    return reply(args);
  };
  const [events, reminders, add] = createCalendarTools({ run, now, timeZone: "Asia/Tokyo" });
  return { events, reminders, add, calls };
}

test("calendar_events: defaults to now until the end of tomorrow, and reads events in the user's zone", async () => {
  const t = tools(() => ({
    ok: true,
    events: [
      { title: "Dentist", start: "2026-10-05T01:30:00Z", end: "2026-10-05T02:00:00Z", allDay: false, calendar: "Home", location: "Shibuya" },
      { title: "Holiday", start: "2026-10-05T00:00:00Z", end: "2026-10-06T00:00:00Z", allDay: true, calendar: "Home" },
    ],
  }));
  const text = String(await t.events.run({}));
  assert.equal(t.calls[0][0], "events");
  assert.equal(t.calls[0][1], now().toISOString());
  assert.ok(new Date(t.calls[0][2]) > now());
  assert.match(text, /Mon 5 Oct, 10:30–11:00: Dentist at Shibuya/);
  assert.match(text, /\(all day\): Holiday/);
});

test("calendar_events: no events, bad dates, and a refusal from the helper", async () => {
  const empty = tools(() => ({ ok: true, events: [] }));
  assert.match(String(await empty.events.run({ from: "2026-10-05T00:00:00+09:00", to: "2026-10-06T00:00:00+09:00" })), /^No events/);
  await assert.rejects(Promise.resolve(empty.events.run({ from: "next tuesday" })), /not a date/);
  const denied = tools(() => ({ ok: false, error: "ZENO is not allowed to see your calendar.", denied: true }));
  await assert.rejects(Promise.resolve(denied.events.run({})), /not allowed to see your calendar/);
});

test("reminders: list and add, refusing a past due time and an empty title", async () => {
  const t = tools((args) =>
    args[0] === "reminders"
      ? { ok: true, reminders: [{ title: "Call Asha", list: "Reminders", due: "2026-10-04T09:00:00Z" }, { title: "Buy rice", list: "Shopping" }] }
      : { ok: true, title: args[1], list: "Reminders", ...(args[2] ? { due: args[2] } : {}) },
  );
  const list = String(await t.reminders.run({}));
  assert.match(list, /Call Asha \(due Sun 4 Oct, 18:00\) \[Reminders\]/);
  assert.match(list, /Buy rice \[Shopping\]/);
  assert.match(String(await t.add.run({ title: "  Water the plants ", due: "2026-10-04T19:00:00+09:00" })), /Added "Water the plants" to Reminders, due Sun 4 Oct, 19:00/);
  assert.deepEqual(t.calls.at(-1), ["add-reminder", "Water the plants", "2026-10-04T10:00:00.000Z"]);
  await assert.rejects(Promise.resolve(t.add.run({ title: "Late", due: "2026-10-03T09:00:00+09:00" })), /in the past/);
  await assert.rejects(Promise.resolve(t.add.run({ title: " " })), /title is required/);
});
