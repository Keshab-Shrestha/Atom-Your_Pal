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

test("the summary lists the newest calls with their kind, tokens and gap, no text (token cost, job 4)", () => {
  let clock = new Date(2026, 9, 5, 10);
  const usage = usageTable(new DatabaseSync(":memory:"), () => clock);
  usage.add({ source: "chat", model: "m", input: 3, output: 15, cacheRead: 0, cacheWrite: 6100, chatId: "c" });
  clock = new Date(clock.getTime() + 3_000);
  usage.add({ source: "chat", helper: "note", model: "m", input: 2, output: 7, cacheRead: 0, cacheWrite: 1000, chatId: "c" });
  usage.add({ source: "job", helper: "sid", job: 1, model: "w", input: 9, output: 9, cacheRead: 9, cacheWrite: 9 });
  for (let i = 0; i < 9; i++) usage.add({ source: "chat", model: "m", input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
  const recent = usage.summary().recent;
  assert.equal(recent.length, 8, "the newest eight");
  usage.summary().recent.forEach((r) => assert.deepEqual(Object.keys(r).filter((k) => !["gapMs"].includes(k)).sort(), ["at", "cacheRead", "cacheWrite", "input", "kind", "model", "output"]));
  const small = usageTable(new DatabaseSync(":memory:"), () => clock);
  small.add({ source: "chat", model: "m", input: 3, output: 15, cacheRead: 0, cacheWrite: 6100, chatId: "c" });
  clock = new Date(clock.getTime() + 3_000);
  small.add({ source: "chat", helper: "note", model: "m", input: 2, output: 7, cacheRead: 0, cacheWrite: 1000, chatId: "c" });
  small.add({ source: "job", helper: "sid", job: 1, model: "w", input: 9, output: 9, cacheRead: 9, cacheWrite: 9 });
  assert.deepEqual(small.summary().recent.map((r) => [r.kind, r.gapMs]), [["job", undefined], ["note", 3000], ["turn", undefined]]);
  assert.equal(small.summary().recent[2].cacheWrite, 6100);
});

// 2026-10-15: dollars are priced from each row's own tokens (pricing.ts), so a worker's row has its own dollars and a chat
// row no longer carries the cost of the agents it started.

test("a worker's row is priced from its tokens, even when Claude Code reported no cost; the total is the sum of the rows", () => {
  const raw = new DatabaseSync(":memory:");
  const usage = usageTable(raw, () => new Date("2026-10-15T10:00:00.000Z"));
  // Sid on Sonnet: 10003 written (1 h), 9588 read, 734 out, 6 in. Claude Code reported no cost for it (the old $0.00).
  usage.add({ source: "job", helper: "sid", job: 5, model: "claude-sonnet-5-5", input: 6, output: 734, cacheRead: 9588, cacheWrite: 10003, cacheTtl: "1h" });
  // The chat's own Opus turn, with a Claude Code cost that included Sid's work: ignored for a model that has a price.
  usage.add({ source: "chat", model: "claude-opus-5-5", input: 2, output: 16, cacheRead: 3623, cacheWrite: 1623, cacheTtl: "1h", dollars: 0.5 });
  const rows = raw.prepare("SELECT source, dollars, dollars_sdk FROM usage ORDER BY id").all() as { source: string; dollars: number; dollars_sdk: number | null }[];
  assert.ok(Math.abs(rows[0]!.dollars - 0.049282) < 1e-6, `Sid's row is $0.0493, got ${rows[0]!.dollars}`);
  assert.ok(Math.abs(rows[1]!.dollars - 0.01475) < 0.0005, `the chat row is its own Opus tokens, got ${rows[1]!.dollars}`);
  assert.equal(rows[1]!.dollars_sdk, 0.5, "what Claude Code reported is kept");
  assert.ok(Math.abs(usage.summary().today.dollars - (rows[0]!.dollars + rows[1]!.dollars)) < 1e-9);
  const sid = usage.summary().byWorker.find((w) => w.helper === "sid")!;
  assert.ok(sid.dollars > 0.049, "the worker's share shows its dollars");
});

test("a model with no listed price keeps the dollars Claude Code reported", () => {
  const usage = usageTable(new DatabaseSync(":memory:"), () => new Date("2026-10-15T10:00:00.000Z"));
  usage.add({ source: "chat", model: "claude-future-9", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, dollars: 0.07 });
  usage.add({ source: "job", helper: "sid", job: 1, model: "claude-future-9", input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
  assert.equal(usage.summary().today.dollars, 0.07, "reported when there is one, else nothing");
});

test("an old table is repriced once: the reported dollars are kept in dollars_sdk, rows of unknown models are left as they were", () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('chat', 'job')),
    helper TEXT, job_id INTEGER, model TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL,
    cache_write INTEGER NOT NULL, dollars REAL NOT NULL DEFAULT 0)`);
  raw.exec("INSERT INTO usage (at, source, helper, job_id, model, input, output, cache_read, cache_write, dollars) VALUES ('2026-10-14T01:00:00.000Z', 'job', 'sid', 5, 'claude-sonnet-5-5', 6, 734, 9588, 10003, 0)");
  raw.exec("INSERT INTO usage (at, source, model, input, output, cache_read, cache_write, dollars) VALUES ('2026-10-14T01:00:00.000Z', 'chat', 'claude-opus-5-5', 2, 13, 0, 5097, 0.5)");
  raw.exec("INSERT INTO usage (at, source, model, input, output, cache_read, cache_write, dollars) VALUES ('2026-10-14T01:00:00.000Z', 'chat', 'claude-future-9', 1, 1, 0, 0, 0.07)");
  usageTable(raw, () => new Date("2026-10-15T00:00:00.000Z"));
  const rows = raw.prepare("SELECT dollars, dollars_sdk FROM usage ORDER BY id").all() as { dollars: number; dollars_sdk: number }[];
  assert.ok(Math.abs(rows[0]!.dollars - 0.049282) < 1e-6 && rows[0]!.dollars_sdk === 0, "a worker row that had $0 now has its dollars");
  assert.ok(Math.abs(rows[1]!.dollars - 0.041044) < 1e-6 && rows[1]!.dollars_sdk === 0.5, "the Opus row is priced from its own tokens");
  assert.deepEqual([rows[2]!.dollars, rows[2]!.dollars_sdk], [0.07, 0.07], "an unknown model is left as it was");
  const before = rows.map((r) => r.dollars);
  usageTable(raw); // a second open does not reprice again
  assert.deepEqual((raw.prepare("SELECT dollars FROM usage ORDER BY id").all() as { dollars: number }[]).map((r) => r.dollars), before);
});

test("recorded() sums a chat's rows on one model, without its conversation notes; an Other row has its own kind", () => {
  const usage = usageTable(new DatabaseSync(":memory:"), () => new Date("2026-10-15T10:00:00.000Z"));
  const row = { source: "chat" as const, model: "claude-haiku-5-5", output: 0, cacheRead: 0, cacheWrite: 0 };
  usage.add({ ...row, input: 10, chatId: "c1" });
  usage.add({ ...row, input: 5, chatId: "c1", helper: "claude-code" });
  usage.add({ ...row, input: 700, chatId: "c1", helper: "note" });
  usage.add({ ...row, input: 900, chatId: "c2" });
  assert.equal(usage.recorded("c1", "claude-haiku-5-5").input, 15);
  assert.equal(usage.recorded("c1", "other-model").input, 0);
  assert.deepEqual(usage.summary().recent.map((r) => r.kind), ["turn", "note", "other", "turn"]);
});

// 2026-10-16: web searches are counted on a row and priced at a cent each, on top of the tokens; recorded() reports them for the "Other" rows.
test("web searches on a row add a cent each to its dollars, and recorded() counts them (also for a model with no listed price)", () => {
  const raw = new DatabaseSync(":memory:");
  const usage = usageTable(raw, () => new Date("2026-10-16T10:00:00.000Z"));
  const row = { source: "chat" as const, helper: "claude-code", chatId: "c1", input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  usage.add({ ...row, model: "claude-sonnet-5-5", webSearches: 2 });
  usage.add({ ...row, model: "claude-future-9", webSearches: 1, dollars: 0.5 });
  const rows = raw.prepare("SELECT model, dollars, web_searches FROM usage ORDER BY id").all() as { model: string; dollars: number; web_searches: number }[];
  assert.deepEqual(rows.map((r) => [r.model, r.web_searches]), [["claude-sonnet-5-5", 2], ["claude-future-9", 1]]);
  assert.equal(rows[0]!.dollars, 0.02, "two searches, no tokens");
  assert.equal(rows[1]!.dollars, 0.51, "an unpriced model: what Claude Code reported plus the search");
  assert.deepEqual(usage.recorded("c1", "claude-sonnet-5-5"), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 2 });
});

test("an old table gets the web_searches column and its rows count as zero searches", () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('chat', 'job')),
    helper TEXT, job_id INTEGER, model TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL,
    cache_write INTEGER NOT NULL, dollars REAL NOT NULL DEFAULT 0, chat_id TEXT, gap_ms INTEGER, cache_ttl TEXT, dollars_sdk REAL)`);
  raw.exec("INSERT INTO usage (at, source, model, input, output, cache_read, cache_write, dollars, chat_id) VALUES ('2026-10-15T01:00:00.000Z', 'chat', 'm', 1, 1, 0, 0, 0.01, 'c1')");
  const usage = usageTable(raw, () => new Date("2026-10-16T00:00:00.000Z"));
  usageTable(raw); // a second open is harmless
  assert.equal(usage.recorded("c1", "m").webSearches, 0);
});

// 2026-10-16 (code check): the goals migration added chat_posted_at and filled it in two separate statements.
test("an old goals table gets chat_posted_at filled for goals that had ended, in one step", async () => {
  const { createSchema } = await import("./store-schema.ts");
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE goals (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at TEXT NOT NULL, ended_at TEXT, report TEXT, source TEXT)");
  raw.exec("INSERT INTO goals (text, created_at, ended_at) VALUES ('done goal', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'), ('open goal', '2026-10-03T00:00:00.000Z', NULL)");
  createSchema(raw);
  createSchema(raw); // a second open changes nothing
  const rows = raw.prepare("SELECT text, chat_posted_at FROM goals ORDER BY id").all() as { text: string; chat_posted_at: string | null }[];
  assert.deepEqual(rows.map((r) => [r.text, r.chat_posted_at]), [["done goal", "2026-10-02T00:00:00.000Z"], ["open goal", null]]);
});
