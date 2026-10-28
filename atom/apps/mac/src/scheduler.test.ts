import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleTick } from "./scheduler.ts";

// Task 3.9: the clock's tick, with a fake store and log.

function fakeLog() {
  const lines: [string, string, Record<string, unknown> | undefined][] = [];
  return { lines, info: (e: string, f?: Record<string, unknown>) => lines.push(["info", e, f]), warn: (e: string, f?: Record<string, unknown>) => lines.push(["warn", e, f]) };
}

test("ADR-110 N3: a tick gives the routines the start", () => {
  const calls: unknown[] = [];
  const start = () => true;
  const store = { runRoutines: (s: unknown) => (calls.push(["routines", s === start]), { made: [], skipped: [] }) };
  scheduleTick(store, fakeLog(), () => ({}), start);
  assert.deepEqual(calls, [["routines", true]]);
});

test("a routine failure is logged by its words, not its task", () => {
  const store = { runRoutines: (): never => { throw new Error("db busy"); } };
  const log = fakeLog();
  scheduleTick(store, log, (e) => ({ message: (e as Error).message }), () => true);
  assert.deepEqual(log.lines, [["warn", "routines.failed", { message: "db busy" }]]);
});
