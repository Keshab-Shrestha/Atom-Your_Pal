import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DISMISS_DAYS, MAX_OPEN, createImproveStore, createImprover, findingsFrom, normalizeReason, parseSuggestions, readLogTail, summarize, type Finding } from "./improve.ts";

const NOW = new Date("2026-11-05T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const line = (event: string, fields: Record<string, unknown> = {}, hours = 1, level = "info") => JSON.stringify({ time: ago(hours), level, event, ...fields });
const many = (n: number, make: (i: number) => string) => Array.from({ length: n }, (_, i) => make(i));

test("reasons lose digits, paths and quoted names so one fault counts once, and keep no long text", () => {
  assert.equal(normalizeReason('Could not read "Brave Browser": session \'ark\' has ended at /Users/me/x/y.log pid 942'), 'Could not read "…": session \'…\' has ended at ~ pid #');
  assert.equal(normalizeReason("x".repeat(500)).length, 90);
  assert.equal(normalizeReason(undefined), "");
});

test("summarize counts the last week only, skips bad lines, and ignores a requested exit", () => {
  const signals = summarize([
    "not json", line("tool.call", { name: "weather", ok: false }), line("tool.call", { name: "weather", ok: true }),
    line("tool.call", { name: "weather", ok: false }, 24 * 8), // older than a week
    line("island.runtime.exit", { code: 137, requested: false }), line("island.runtime.exit", { code: 0, requested: true }), line("island.runtime.exit", { code: 1, requested: true }),
    line("api.unauthorized", { count: 5 }, 1, "warn"), line("session.over_budget"), line("turn.over_budget"),
    line("island.bad_command", { reason: "bad" }, 1, "warn"), line("laya.lost", { reason: "could not start: spawn /Users/me/laya ENOENT" }, 1, "warn"),
    line("computer.action", { action: "look", ok: false, reason: "TextEdit is not running." }), line("computer.action", { action: "look", ok: true }),
  ], NOW);
  assert.deepEqual(signals.tools, [{ name: "weather", total: 2, failed: 1 }]);
  assert.deepEqual(signals.exits, [{ code: "137", count: 1 }]);
  assert.equal(signals.unauthorized, 1);
  assert.deepEqual(signals.overBudget, { session: 1, turn: 1 });
  assert.deepEqual(signals.computerFailures, [{ reason: "TextEdit is not running.", count: 1 }]);
  assert.deepEqual(signals.warnings, [{ event: "laya.lost", message: "could not start: spawn ~ ENOENT", count: 1 }], "quiet warnings are not counted");
});

test("findings come from counts with thresholds, worst first, with stable ids", () => {
  const lines = [
    ...many(8, () => line("island.runtime.exit", { code: 137, requested: false })),
    ...many(12, (i) => line("tool.call", { name: "weather", ok: i >= 4 })),
    ...many(3, () => line("computer.action", { ok: false, reason: "Calculator is not running. Use action \"open\" first." })),
    ...many(60, () => line("api.unauthorized", {}, 1, "warn")),
    ...many(25, () => line("laya.lost", { reason: "could not start" }, 1, "warn")),
    ...many(2, () => line("island.runtime.exit", { code: 78, requested: false })),
    ...many(10, () => line("tool.call", { name: "open_url", ok: true })),
  ];
  const found = findingsFrom(summarize(lines, NOW));
  assert.deepEqual(found.map((f) => f.id), ["crash:137", "unauthorized:api", "tool:weather", "computer:calculator-is-not-running-use-action-first", "warning:laya-lost-could-not-start"]);
  assert.equal(found[0]!.severity, 3);
  assert.match(found[2]!.evidence, /4 of 12 calls failed/);
  assert.equal(findingsFrom(summarize(lines, NOW)).map((f) => f.id).join(), found.map((f) => f.id).join(), "ids are stable");
});

test("a quiet week gives no findings; a few failures are not enough", () => {
  assert.deepEqual(findingsFrom(summarize([line("tool.call", { name: "a", ok: false }), line("tool.call", { name: "a", ok: true }), line("island.runtime.exit", { code: 1, requested: false })], NOW)), []);
});

test("suggestions keep only the findings that were given, trimmed, one each", () => {
  const given = [{ id: "a" }, { id: "b" }] as Finding[];
  const text = 'Here you go: [{"id":"a","why":"  It stops   work. ","change":"Restart the helper."},{"id":"z","why":"x","change":"y"},{"id":"b","why":5,"change":"y"},{"id":"a","why":"dup","change":"dup"}] done';
  assert.deepEqual(parseSuggestions(text, given), [{ id: "a", why: "It stops work.", change: "Restart the helper." }]);
  assert.deepEqual(parseSuggestions("no json", given), []);
  assert.deepEqual(parseSuggestions("[not json]", given), []);
});

function setup(options: { suggest?: (f: readonly Finding[]) => Promise<string>; lines?: string[] } = {}) {
  const store = createImproveStore();
  const asked: Finding[][] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  let clock = NOW;
  const improver = createImprover({
    store, logPath: "unused", now: () => clock, log: (e, f) => logs.push([e, f]),
    readLines: () => options.lines ?? many(8, () => JSON.stringify({ time: new Date(clock.getTime() - 3_600_000).toISOString(), level: "info", event: "island.runtime.exit", code: 137, requested: false })),
    suggest: async (f) => { asked.push([...f]); return options.suggest ? options.suggest(f) : '[{"id":"crash:137","why":"It loses your work.","change":"Find why the runtime is killed."}]'; },
  });
  return { store, improver, asked, logs, tick: (h: number) => { clock = new Date(clock.getTime() + h * 3_600_000); } };
}

test("a run makes notes with the model's words; the model sees counts only; a second run within 20 hours does nothing", async () => {
  const s = setup();
  assert.deepEqual(await s.improver.run(), { notes: 1, ran: true });
  const note = s.store.read().notes[0]!;
  assert.deepEqual([note.id, note.why, note.change], ["crash:137", "It loses your work.", "Find why the runtime is killed."]);
  assert.deepEqual(Object.keys(s.asked[0]![0]!).sort(), ["count", "evidence", "id", "kind", "severity", "title"]);
  await s.improver.maybeRun();
  assert.equal(s.asked.length, 1, "too soon");
  s.tick(21);
  await s.improver.maybeRun();
  assert.equal(s.asked.length, 1, "the known note is not asked about again");
  assert.equal(s.store.read().notes.length, 1);
});

test("a failed or empty model call still leaves the plain note", async () => {
  const failing = setup({ suggest: async () => { throw new Error("offline"); } });
  await failing.improver.run();
  assert.match(failing.store.read().notes[0]!.why, /often enough to count/);
  assert.equal(failing.logs.some(([e]) => e === "improve.suggest_failed"), true);
  const empty = setup({ suggest: async () => "I cannot help" });
  await empty.improver.run();
  assert.equal(empty.store.read().notes.length, 1);
});

test("a dismissed finding stays away for 30 days; the switch stops the daily run but not a forced one", async () => {
  const s = setup();
  await s.improver.run();
  const state = s.store.read();
  s.store.write({ ...state, notes: [], dismissed: { "crash:137": NOW.toISOString() } });
  s.tick(25);
  await s.improver.maybeRun();
  assert.deepEqual(s.store.read().notes, []);
  s.tick(DISMISS_DAYS * 24);
  await s.improver.run({ force: true });
  assert.equal(s.store.read().notes.length, 1, "after 30 days it may come back");
  s.store.write({ ...s.store.read(), enabled: false, lastRunAt: undefined });
  const before = s.asked.length;
  await s.improver.maybeRun();
  assert.equal(s.asked.length, before, "off: no daily run");
  assert.equal((await s.improver.run({ force: true })).ran, true);
});

test("at most three notes, the worst first", async () => {
  const lines = [
    ...many(8, () => line("island.runtime.exit", { code: 137, requested: false })),
    ...many(10, (i) => line("tool.call", { name: `t${i % 5}`, ok: false })),
    ...many(60, () => line("api.unauthorized", {}, 1, "warn")),
    ...many(30, () => line("laya.lost", { reason: "x" }, 1, "warn")),
  ];
  const s = setup({ lines, suggest: async () => "[]" });
  await s.improver.run();
  const notes = s.store.read().notes;
  assert.equal(notes.length, MAX_OPEN);
  assert.equal(notes[0]!.severity, 3);
});

test("the store keeps notes in a private file; the log tail skips a cut first line", () => {
  const dir = mkdtempSync(join(tmpdir(), "ark-improve-"));
  const path = join(dir, "improvements.json");
  const store = createImproveStore(path);
  store.write({ enabled: false, lastRunAt: NOW.toISOString(), notes: [], dismissed: { a: NOW.toISOString() } });
  const again = createImproveStore(path).read();
  assert.equal(again.enabled, false);
  assert.deepEqual(again.dismissed, { a: NOW.toISOString() });
  assert.equal(JSON.parse(readFileSync(path, "utf8")).enabled, false);
  const log = join(dir, "ark.log");
  writeFileSync(log, `${line("a")}\n${line("b")}\n`);
  assert.equal(readLogTail(log).filter(Boolean).length, 2);
  assert.deepEqual(readLogTail(join(dir, "missing.log")), []);
});
