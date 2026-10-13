import { test } from "node:test";
import assert from "node:assert/strict";
import { openHelperStore } from "@atom/helpers";
import { createChatUsageRecorder } from "./usage-report.ts";

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
