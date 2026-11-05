import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats, MAX_TOOL_ROWS } from "./stats.ts";

const now = new Date("2026-11-05T12:00:00Z");
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
const line = (o: Record<string, unknown>) => JSON.stringify({ level: "info", ...o });

test("counts calls, failures, average time and repeats per tool, busiest first", () => {
  const lines = [
    line({ time: at(1), event: "tool.call", name: "computer", ok: true, ms: 100 }),
    line({ time: at(1), event: "tool.call", name: "computer", ok: false, reason: "failed", ms: 300 }),
    line({ time: at(2), event: "tool.call", name: "computer", ok: true, ms: 200, repeat: 3 }),
    line({ time: at(2), event: "tool.call", name: "weather", ok: true, ms: 50 }),
  ];
  const s = computeStats(lines, now);
  assert.deepEqual(s.tools, [
    { name: "computer", calls: 3, failed: 1, avgMs: 200, repeats: 1 },
    { name: "weather", calls: 1, failed: 0, avgMs: 50, repeats: 0 },
  ]);
  assert.equal(s.totalCalls, 4);
  assert.equal(s.totalFailed, 1);
});

test("a line older than the window, or one that is not JSON, is ignored", () => {
  const lines = [
    line({ time: at(9), event: "tool.call", name: "old", ok: true, ms: 1 }),
    "not json",
    line({ event: "tool.call", name: "no-time", ok: true }),
    line({ time: at(0.1), event: "tool.call", name: "new", ok: true, ms: 1 }),
  ];
  assert.deepEqual(computeStats(lines, now).tools.map((t) => t.name), ["new"]);
});

test("turns: the average model time and the slow ones", () => {
  const lines = [
    line({ time: at(1), event: "turn.complete", modelMs: 2000 }),
    line({ time: at(1), event: "turn.complete", modelMs: 20_000 }),
    line({ time: at(1), event: "turn.complete" }),
  ];
  const s = computeStats(lines, now);
  assert.equal(s.turns, 2);
  assert.equal(s.avgTurnMs, 11_000);
  assert.equal(s.slowTurns, 1);
});

test("an empty log gives zeros, and only the busiest tools are kept", () => {
  assert.deepEqual(computeStats([], now), { days: 7, turns: 0, avgTurnMs: 0, slowTurns: 0, totalCalls: 0, totalFailed: 0, tools: [] });
  const many = Array.from({ length: 20 }, (_, i) => line({ time: at(1), event: "tool.call", name: `t${String(i).padStart(2, "0")}`, ok: true, ms: 1 }));
  const s = computeStats(many, now);
  assert.equal(s.tools.length, MAX_TOOL_ROWS);
  assert.equal(s.totalCalls, 20, "the totals count every tool, not only the rows shown");
});
