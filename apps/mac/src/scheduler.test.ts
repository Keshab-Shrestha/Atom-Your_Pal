import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleTick } from "./scheduler.ts";

// ADR-094: the clock's tick, with a fake store and log.

function fakeLog() {
  const lines: [string, string, Record<string, unknown> | undefined][] = [];
  return { lines, info: (e: string, f?: Record<string, unknown>) => lines.push(["info", e, f]), warn: (e: string, f?: Record<string, unknown>) => lines.push(["warn", e, f]) };
}

test("a tick runs routines, then wake-ups with the plan's use, and logs each wake by ids", () => {
  const calls: unknown[] = [];
  const store = {
    runRoutines: () => (calls.push("routines"), { made: [], skipped: [] }),
    runWakeUps: (planUsed?: number) => (calls.push(["wake", planUsed]), [{ helper: "sid", teamTask: 3, job: 9 }, { helper: "penny" }]),
  };
  const log = fakeLog();
  scheduleTick(store, 42, log, () => ({}));
  assert.deepEqual(calls, ["routines", ["wake", 42]]);
  assert.deepEqual(log.lines, [["info", "wakeup.woke", { helper: "sid", teamTask: 3, job: 9 }], ["info", "wakeup.woke", { helper: "penny" }]]);
});

test("a routine failure does not stop the wake-ups; each failure is logged", () => {
  const store = {
    runRoutines: (): never => { throw new Error("db busy"); },
    runWakeUps: (): never => { throw new Error("db busy"); },
  };
  const log = fakeLog();
  scheduleTick(store, undefined, log, (e) => ({ message: (e as Error).message }));
  assert.deepEqual(log.lines.map((l) => [l[0], l[1]]), [["warn", "routines.failed"], ["warn", "wakeups.failed"]]);
});
