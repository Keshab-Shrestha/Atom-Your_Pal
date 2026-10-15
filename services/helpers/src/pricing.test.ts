import { test } from "node:test";
import assert from "node:assert/strict";
import { dollarsFor, ratesFor } from "./pricing.ts";

// 2026-10-15: the SDK's own per-model cost (`modelUsage[model].costUSD`, costBasis "list") for tiny real calls, and the
// tokens they used. The price table must give those dollars. If a model's price changes, this test fails first.

const real = [
  { model: "claude-haiku-4-5-20251001", input: 672, output: 47, cacheRead: 0, cacheWrite: 0, ttl: undefined, costUSD: 0.000907 },
  { model: "claude-haiku-5-5", input: 1174, output: 14, cacheRead: 0, cacheWrite: 0, ttl: undefined, costUSD: 0.0001244 },
  { model: "claude-haiku-5-5", input: 1176, output: 18, cacheRead: 0, cacheWrite: 824, ttl: "1h", costUSD: 0.0002914 },
  { model: "claude-sonnet-5-5", input: 2, output: 4, cacheRead: 0, cacheWrite: 826, ttl: "1h", costUSD: 0.003348 },
  { model: "claude-opus-5-5", input: 2, output: 4, cacheRead: 0, cacheWrite: 822, ttl: "1h", costUSD: 0.006664 },
];

test("the price table gives the SDK's own cost for each model it measured", () => {
  for (const r of real) {
    const got = dollarsFor(r.model, r, r.ttl)!;
    assert.ok(Math.abs(got - r.costUSD) < 2e-6, `${r.model}: ${got} vs the SDK's ${r.costUSD}`);
  }
});

test("a row of ATOM's own table is priced as it was recorded (an Opus chat turn, cold cache)", () => {
  // usage row 73 (2026-10-15): input 2, output 13, cache written 5097 (1 h): recorded $0.041.
  assert.ok(Math.abs(dollarsFor("claude-opus-5-5", { input: 2, output: 13, cacheRead: 0, cacheWrite: 5097 }, "1h")! - 0.041044) < 1e-6);
});

test("a cache read costs a tenth of the input price and a 5-minute write costs less than a 1-hour write", () => {
  const read = dollarsFor("claude-opus-5-5", { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 })!;
  assert.equal(read, 0.4);
  const w5 = dollarsFor("claude-sonnet-5-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 }, "5m")!;
  const w1 = dollarsFor("claude-sonnet-5-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 }, "1h")!;
  assert.deepEqual([w5, w1], [2.5, 4]);
});

test("a model id with a date suffix finds its family; an unknown model has no price", () => {
  assert.deepEqual(ratesFor("claude-haiku-4-5-20251001"), { input: 1, output: 5 });
  assert.equal(ratesFor("claude-opus-5-5")?.output, 20);
  assert.equal(ratesFor("some-future-model"), undefined);
  assert.equal(dollarsFor("some-future-model", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }), undefined);
  assert.equal(dollarsFor("unknown", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), undefined);
});
