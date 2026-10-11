import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { localDay, openHelperStore, tokensIn, usageTable } from "./index.ts";

// ADR-091: tokens per run, summed for the Dashboard: today, 7 days, by worker and model.

test("tokens are summed by day, worker (chat apart) and model; older days fall out of the week", () => {
  let clock = new Date(2026, 9, 5, 10);
  const usage = usageTable(new DatabaseSync(":memory:"), () => clock);
  usage.add({ source: "job", helper: "sid", job: 1, model: "claude-sonnet-5-5", input: 100, output: 50, cacheRead: 1000, cacheWrite: 10, dollars: 0.02 });
  clock = new Date(2026, 9, 11, 9);
  usage.add({ source: "job", helper: "sid", job: 2, model: "claude-sonnet-5-5", input: 200, output: 80, cacheRead: 0, cacheWrite: 0 });
  usage.add({ source: "chat", model: "claude-haiku-5-5", input: 30, output: 20, cacheRead: 500, cacheWrite: 0, dollars: 0.001 });
  usage.add({ source: "job", helper: "kame", job: 3, model: "claude-sonnet-5-5", input: -5, output: Number.NaN, cacheRead: 7, cacheWrite: 0 });
  const s = usage.summary();
  assert.equal(s.days.length, 7);
  assert.equal(s.days.at(-1)!.day, localDay(clock));
  assert.deepEqual([s.today.runs, s.today.input, s.today.output, s.today.cacheRead], [3, 230, 100, 507], "bad counts are 0");
  assert.equal(s.week.runs, 4, "the 5th is inside the last 7 days");
  assert.deepEqual(s.byWorker.map((w) => [w.helper, tokensIn(w)]), [["sid", 1440], [null, 550], ["kame", 7]]);
  assert.deepEqual(s.byModel.map((m) => [m.model, m.runs]), [["claude-sonnet-5-5", 3], ["claude-haiku-5-5", 1]]);
  clock = new Date(2026, 9, 20, 9);
  assert.equal(usageTable(new DatabaseSync(":memory:"), () => clock).summary().week.runs, 0);
});

test("the store records usage and tells the window (ADR-091)", () => {
  const store = openHelperStore({ path: ":memory:" });
  const changes: string[] = [];
  store.onChange((c) => changes.push(c.action));
  store.addUsage({ source: "chat", model: "m", input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
  assert.equal(store.usage().today.output, 2);
  assert.deepEqual(changes, ["usage"]);
});
