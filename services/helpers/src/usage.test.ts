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

// Token cost, job 1: chat id, the gap since the chat's last call, and the cache lifetime.

test("an old usage table gets chat_id, gap_ms and cache_ttl; old rows stay NULL and still count", () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('chat', 'job')),
    helper TEXT, job_id INTEGER, model TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL,
    cache_write INTEGER NOT NULL, dollars REAL NOT NULL DEFAULT 0)`);
  raw.exec("INSERT INTO usage (at, source, model, input, output, cache_read, cache_write) VALUES ('2026-10-05T01:00:00.000Z', 'chat', 'm', 1, 2, 3, 4)");
  const usage = usageTable(raw, () => new Date("2026-10-05T02:00:00.000Z"));
  usageTable(raw); // a second open is harmless
  assert.deepEqual(usage.add({ source: "chat", model: "m", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, chatId: "c", cacheTtl: "1h" }), { gapMs: null });
  const rows = raw.prepare("SELECT chat_id, gap_ms, cache_ttl FROM usage ORDER BY id").all() as Record<string, unknown>[];
  assert.deepEqual(rows.map((r) => [r.chat_id, r.gap_ms, r.cache_ttl]), [[null, null, null], ["c", null, "1h"]]);
  assert.equal(usage.summary().today.runs, 2);
});

test("the gap is measured per chat and per model; the first call has none; a restart seeds it from the table", () => {
  let clock = new Date("2026-10-05T10:00:00.000Z");
  const raw = new DatabaseSync(":memory:");
  const usage = usageTable(raw, () => clock);
  const row = { source: "chat" as const, input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
  assert.equal(usage.add({ ...row, model: "a", chatId: "c1" }).gapMs, null, "first call");
  clock = new Date(clock.getTime() + 90_000);
  assert.equal(usage.add({ ...row, model: "a", chatId: "c1" }).gapMs, 90_000, "second call");
  assert.equal(usage.add({ ...row, model: "a", chatId: "c2" }).gapMs, null, "another chat");
  assert.equal(usage.add({ ...row, model: "b", chatId: "c1" }).gapMs, null, "another model");
  clock = new Date(clock.getTime() + 5_000);
  assert.equal(usage.add({ ...row, model: "a" }).gapMs, null, "no chat: no gap");
  assert.equal(usage.add({ ...row, model: "a", chatId: "c1" }).gapMs, 5_000, "since the newest call of that chat and model");
  clock = new Date(clock.getTime() + 1_000);
  assert.equal(usageTable(raw, () => clock).add({ ...row, model: "a", chatId: "c1" }).gapMs, 1_000, "seeded from the table");
});
