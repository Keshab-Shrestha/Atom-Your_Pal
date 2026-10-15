import { test } from "node:test";
import assert from "node:assert/strict";
import { openHelperStore } from "@atom/helpers";
import { createChatUsageRecorder, createOverheadRecorder } from "./usage-report.ts";

test("a chat turn and its note record the chat id; the log line has numbers and names only (token cost, job 1)", () => {
  const store = openHelperStore({ path: ":memory:" });
  const lines: { event: string; fields: Record<string, unknown> }[] = [];
  const record = createChatUsageRecorder(store, { info: (event: string, fields?: Record<string, unknown>) => void lines.push({ event, fields: fields ?? {} }) });
  const tokens = { input: 3, output: 15, cacheRead: 0, cacheWrite: 6100, costUsd: 0.1, cacheTtl: "1h" };
  record(tokens, "opus", { chatId: "c1" });
  record({ ...tokens, cacheWrite: 800 }, "opus", { chatId: "c1", background: true });
  record(tokens, "opus"); // an old caller: no chat
  assert.deepEqual(lines.map((l) => l.event), ["usage.turn", "usage.turn", "usage.turn"]);
  assert.ok(!("gapMs" in lines[0].fields), "first call: no gap");
  assert.equal(typeof lines[1].fields.gapMs, "number");
  assert.equal(lines[1].fields.source, "note");
  assert.ok(!("gapMs" in lines[2].fields));
  for (const l of lines) {
    assert.deepEqual(Object.keys(l.fields).filter((k) => k !== "gapMs").sort(), ["cacheRead", "cacheWrite", "input", "model", "output", "source"]);
    for (const v of Object.values(l.fields)) assert.ok(typeof v === "number" || v === "opus" || v === "chat" || v === "note");
  }
  assert.equal(store.usage().today.runs, 3);
});

// 2026-10-15: Claude Code's running totals (modelUsage) hold the calls no row has. After a turn settles, the difference is one
// "Other" row; the live Sid run showed 30 output tokens in the rows against 1,620 in the transcript, and a web page read by
// Claude Code's own small model that no row held.
const quiet = { info: () => undefined };
const meta = { chatId: "c1", resumed: false, first: false, background: 0 };
const rows = (store: ReturnType<typeof openHelperStore>) => store.usage().recent.map((r) => [r.kind, r.model, r.input + r.output, r.cacheWrite, r.cacheRead]);

test("the tokens in Claude Code's totals and in no row become one Other row per model, after the turn settles", async () => {
  const store = openHelperStore({ path: ":memory:" });
  store.addUsage({ source: "chat", model: "claude-haiku-5-5", chatId: "c1", input: 4, output: 480, cacheRead: 5249, cacheWrite: 5917 });
  store.addUsage({ source: "job", helper: "sid", job: 1, model: "claude-sonnet-5-5", chatId: "c1", input: 6, output: 30, cacheRead: 10715, cacheWrite: 8334 });
  const record = createOverheadRecorder(store, quiet, 5);
  record(
    {
      "claude-haiku-5-5": { input: 4 + 1174, output: 480 + 14, cacheRead: 5249, cacheWrite: 5917 },
      "claude-sonnet-5-5": { input: 6, output: 1620, cacheRead: 10715, cacheWrite: 8334 },
    },
    meta,
  );
  assert.deepEqual(rows(store).filter((r) => r[0] === "other"), [], "nothing yet: the rows of an agent may still be on the way");
  await new Promise((r) => setTimeout(r, 30));
  const other = rows(store).filter((r) => r[0] === "other");
  assert.deepEqual(other.map((r) => [r[1], r[2]]).sort(), [["claude-haiku-5-5", 1188], ["claude-sonnet-5-5", 1590]], "the small model call and the cut-short output");
  record({ "claude-haiku-5-5": { input: 4 + 1174, output: 480 + 14, cacheRead: 5249, cacheWrite: 5917 }, "claude-sonnet-5-5": { input: 6, output: 1620, cacheRead: 10715, cacheWrite: 8334 } }, meta);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(rows(store).filter((r) => r[0] === "other").length, 2, "the same totals book nothing twice");
});

test("nothing is booked while agents run; the note of a chat and another chat are not part of the totals", async () => {
  const store = openHelperStore({ path: ":memory:" });
  store.addUsage({ source: "chat", model: "m", chatId: "c1", input: 10, output: 10, cacheRead: 0, cacheWrite: 0 });
  store.addUsage({ source: "chat", helper: "note", model: "m", chatId: "c1", input: 500, output: 500, cacheRead: 0, cacheWrite: 0 });
  store.addUsage({ source: "chat", model: "m", chatId: "c2", input: 900, output: 900, cacheRead: 0, cacheWrite: 0 });
  const record = createOverheadRecorder(store, quiet, 5);
  record({ m: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 } }, { ...meta, background: 1 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(rows(store).filter((r) => r[0] === "other").length, 0, "an agent is running");
  record({ m: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 } }, meta);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(rows(store).filter((r) => r[0] === "other").length, 0, "a note and another chat do not count against the session");
});

test("a resumed session's first result sets the base: the earlier totals are not booked as new", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const record = createOverheadRecorder(store, quiet, 5);
  record({ m: { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0 } }, { chatId: "c1", resumed: true, first: true, background: 0 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(rows(store).filter((r) => r[0] === "other").length, 0, "the past is not booked");
  record({ m: { input: 5100, output: 2050, cacheRead: 0, cacheWrite: 0 } }, { chatId: "c1", resumed: true, first: false, background: 0 });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(rows(store).filter((r) => r[0] === "other").map((r) => r[2]), [150], "only what came after");
});
