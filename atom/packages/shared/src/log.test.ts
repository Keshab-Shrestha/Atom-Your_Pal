import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, migrateLegacyLog } from "./log.ts";

const fixed = () => new Date("2026-10-01T12:00:00.000Z");

test("writes one JSON object per line, filtered by level", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", file: "unused", now: fixed, write: (l) => lines.push(l) });
  log.debug("hidden");
  log.info("turn.complete", { requestId: "r1", modelMs: 1400 });
  log.error("turn.failed", { stage: "model", kind: "rate_limit" });
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [
    { time: "2026-10-01T12:00:00.000Z", level: "info", event: "turn.complete", requestId: "r1", modelMs: 1400 },
    { time: "2026-10-01T12:00:00.000Z", level: "error", event: "turn.failed", stage: "model", kind: "rate_limit" },
  ]);
  assert.ok(lines.every((l) => l.endsWith("\n")));
});

test("creates the log folder and appends", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-log-"));
  try {
    const file = join(dir, "nested", "zeno.log");
    const log = createLogger({ level: "debug", file, now: fixed });
    log.info("a");
    log.info("b");
    assert.deepEqual(readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l).event), ["a", "b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a write failure is reported once and never throws", (t) => {
  const messages: string[] = [];
  t.mock.method(console, "error", (m: string) => messages.push(m));
  const log = createLogger({ level: "info", file: "/x/zeno.log", write: () => { throw new Error("read-only"); } });
  log.info("a");
  log.error("b");
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Logging disabled: cannot write \/x\/zeno.log \(read-only\)/);
});

test("migrateLegacyLog renames the old log only when the new one is absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-log-"));
  const old = join(dir, "zeno.log");
  const next = join(dir, "atom.log");
  writeFileSync(old, "old\n");
  migrateLegacyLog(next, old);
  assert.equal(readFileSync(next, "utf8"), "old\n");
  assert.equal(existsSync(old), false);
  writeFileSync(old, "newer legacy\n");
  migrateLegacyLog(next, old);
  assert.equal(readFileSync(next, "utf8"), "old\n", "an existing new log is never replaced");
  assert.equal(existsSync(old), true);
});
