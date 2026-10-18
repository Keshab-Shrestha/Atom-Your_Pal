import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "@atom/contracts";
import { CHAT_REPLAY_BYTES, HISTORY_PAGE_BYTES, chatContext, chatHistoryTools } from "./chat-history.ts";

test("replay drops only model context, leaves room to grow and preserves the current question", () => {
  const archive: Message[] = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i} ` + "日本語🙂".repeat(200) }));
  const snapshot = structuredClone(archive);
  const first = chatContext(archive, "What launch day? 🤔");
  assert.ok(first.start > 0);
  assert.ok(first.bytes <= CHAT_REPLAY_BYTES / 2);
  assert.deepEqual(archive, snapshot);
  const next = chatContext([...archive, { role: "user", content: "one more" }, { role: "assistant", content: "yes" }], "Continue", CHAT_REPLAY_BYTES, first.start);
  assert.equal(next.start, first.start, "an append retains the provider prefix until the window fills");
  assert.throws(() => chatContext(archive, "x".repeat(CHAT_REPLAY_BYTES)), /Shorten it or attach/);
});

test("literal search pages backwards with stable IDs and can find a fact deep inside a large message", async () => {
  const archive: Message[] = [{ role: "user", content: "x".repeat(60_000) + "Cedar launches Wednesday." + "y".repeat(60_000) }];
  for (let i = 0; i < 20; i++) archive.push({ role: "assistant", content: "Cedar update " + i });
  const tools = chatHistoryTools(() => archive);
  const search = async (input: Record<string, unknown>) => JSON.parse((await tools.run({ id: "s", name: "search_chat_history", input })).content);
  const ids: string[] = [];
  let before: number | undefined;
  do {
    const page = await search({ query: "cedar", ...(before ? { before } : {}) });
    ids.push(...page.hits.map((h: { id: string }) => h.id)); before = page.nextBefore ?? undefined;
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= HISTORY_PAGE_BYTES);
  } while (before);
  assert.equal(new Set(ids).size, 21);
  const fact = await search({ query: "launches Wednesday" });
  assert.equal(fact.hits[0].id, "m1");
  assert.match(fact.hits[0].excerpt, /Cedar launches Wednesday/);
  archive.push({ role: "user", content: "new turn" });
  assert.equal((await search({ query: "launches Wednesday" })).hits[0].id, "m1");
  assert.equal((await search({ query: ".*" })).hits.length, 0, "the query is literal, not a regex");
});

test("reading pages reconstruct original large Unicode/control text exactly within the JSON byte bound", async () => {
  const content = "日本語🙂\n\t\u0001".repeat(4000);
  const archive: Message[] = [{ role: "user", content }, { role: "assistant", content: "last\uD800" }];
  const tools = chatHistoryTools(() => archive);
  let next: { message: number; offset: number } | null = { message: 1, offset: 0 };
  const restored = new Map<string, string>();
  let pages = 0;
  while (next) {
    const response = await tools.run({ id: "r", name: "read_chat_history", input: next });
    assert.equal(response.isError, undefined, response.content);
    assert.ok(Buffer.byteLength(response.content) <= HISTORY_PAGE_BYTES);
    const page = JSON.parse(response.content);
    for (const m of page.messages) restored.set(m.id, (restored.get(m.id) ?? "") + m.text);
    next = page.next;
    assert.ok(++pages < 100);
  }
  assert.equal(restored.get("m1"), content);
  assert.equal(restored.get("m2"), "last\uD800");
});

test("history rejects other-chat arguments, malformed cursors and cancelled reads", async () => {
  let reads = 0;
  const tools = chatHistoryTools(() => (reads++, [{ role: "user", content: "🙂" }]));
  for (const input of [{ chatId: "other" }, { message: -1 }, { message: 1.5 }, { message: 1, offset: 1 }, { message: 1, offset: 8 }, { offset: "0" }]) {
    assert.equal((await tools.run({ id: "r", name: "read_chat_history", input })).isError, true);
  }
  reads = 0;
  assert.equal((await tools.run({ id: "r", name: "read_chat_history", input: { chatId: "other" } })).isError, true);
  assert.equal(reads, 0);
  assert.equal((await tools.run({ id: "r", name: "read_chat_history", input: {} }, AbortSignal.abort())).isError, true);
  assert.equal(reads, 0);
});
