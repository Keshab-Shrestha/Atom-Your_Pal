import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryTools, ftsQuery, looksSecret, memoryContext, MemoryError, openMemoryStore, MAX_MEMORY_CHARS } from "./index.ts";

const voice = { source: "voice" as const, requestId: "req-1" };

function clock() {
  let t = Date.parse("2026-10-04T09:00:00Z");
  return () => new Date((t += 60_000));
}

test("keeps a fact with provenance and finds it by its words", () => {
  const store = openMemoryStore({ path: ":memory:", now: clock() });
  const m = store.add("  Keshab's sister   is called Asha. ", voice);
  assert.equal(m.text, "Keshab's sister is called Asha.");
  assert.equal(m.owner, "local");
  assert.equal(m.scope, "personal");
  assert.equal(m.source, "voice");
  assert.equal(m.requestId, "req-1");
  assert.deepEqual(store.search("What is my sister's name?").map((x) => x.id), [m.id]);
  assert.deepEqual(store.search("coffee"), []);
});

test("the same fact twice is kept once", () => {
  const store = openMemoryStore({ path: ":memory:" });
  const a = store.add("Keshab drinks green tea.", voice);
  const b = store.add("keshab drinks GREEN tea.", voice);
  assert.equal(a.id, b.id);
  assert.equal(store.count(), 1);
});

test("refuses empty, too long, and more than the limit; never drops old memories silently", () => {
  const store = openMemoryStore({ path: ":memory:", maxMemories: 2 });
  assert.throws(() => store.add("   ", voice), MemoryError);
  assert.throws(() => store.add("x".repeat(MAX_MEMORY_CHARS + 1), voice), /too long/);
  store.add("one fact", voice);
  store.add("two facts", voice);
  assert.throws(() => store.add("three facts", voice), /full/);
  assert.equal(store.count(), 2);
});

test("forgetting deletes the row and its search entry", () => {
  const store = openMemoryStore({ path: ":memory:" });
  const m = store.add("Keshab's dentist is Dr. Mori.", voice);
  assert.equal(store.remove(m.id), true);
  assert.equal(store.remove(m.id), false);
  assert.equal(store.get(m.id), undefined);
  assert.deepEqual(store.search("dentist"), []);
});

test("another owner's memories are never returned", () => {
  const dir = mkdtempSync(join(tmpdir(), "zeno-mem-"));
  try {
    const path = join(dir, "m.db");
    const mine = openMemoryStore({ path });
    mine.add("Keshab's locker code is in the blue notebook.", voice);
    const theirs = openMemoryStore({ path, owner: "someone-else" });
    assert.equal(theirs.count(), 0);
    assert.deepEqual(theirs.search("locker notebook"), []);
    assert.deepEqual(theirs.recent(), []);
    mine.close();
    theirs.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("memories survive closing and reopening the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "zeno-mem-"));
  try {
    const path = join(dir, "nested", "memory.db");
    const first = openMemoryStore({ path });
    first.add("Keshab lives in Tokyo.", voice);
    first.close();
    const again = openMemoryStore({ path });
    assert.equal(again.count(), 1);
    assert.equal(again.search("Where does he live, Tokyo?")[0]?.text, "Keshab lives in Tokyo.");
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search text can never inject FTS syntax", () => {
  assert.equal(ftsQuery('tea" OR 1=1 NEAR(x) *'), '"tea" OR "near"');
  assert.equal(ftsQuery("?? !! a"), undefined);
  const store = openMemoryStore({ path: ":memory:" });
  store.add("Keshab likes tea.", voice);
  assert.doesNotThrow(() => store.search('"); DROP TABLE memories; --'));
  assert.equal(store.count(), 1);
});

test("context: matching memories first, then the newest, with ids; nothing when empty", () => {
  const store = openMemoryStore({ path: ":memory:", now: clock() });
  assert.equal(memoryContext("hello", { store }), undefined);
  const tea = store.add("Keshab drinks green tea.", voice);
  for (let i = 0; i < 5; i++) store.add(`Unrelated fact number ${i}.`, voice);
  const block = memoryContext("Make me a cup of tea", { store, limit: 3 })!;
  assert.match(block, new RegExp(`\\[${tea.id}\\] Keshab drinks green tea\\.`));
  assert.equal(block.split("\n").filter((l) => l.startsWith("[")).length, 3);
  assert.match(block, /3 more kept; use recall/);
});

test("tools: remember, recall and forget, with provenance and a log that never holds the text", () => {
  const store = openMemoryStore({ path: ":memory:" });
  const changes: unknown[] = [];
  const [remember, recall, forget] = createMemoryTools({ store, provenance: () => ({ source: "text", requestId: "r9" }), onChange: (e) => changes.push(e) });

  assert.equal(remember.run({ fact: "Keshab's birthday is 14 March." }), "Kept as memory 1.");
  assert.equal(remember.run({ fact: "Keshab's birthday is 14 March." }), "Already kept as memory 1.");
  assert.equal(store.get(1)?.requestId, "r9");
  assert.match(recall.run({ query: "when is my birthday" }), /^\[1\] Keshab's birthday is 14 March\./);
  assert.equal(recall.run({ query: "football" }), "Nothing kept matches that.");
  assert.match(recall.run({}), /\[1\]/);
  assert.match(forget.run({ id: 1 }), /^Forgot memory 1/);
  assert.equal(forget.run({ id: 1 }), "There is no memory 1.");
  assert.equal(recall.run({}), "Nothing is kept yet.");
  assert.throws(() => forget.run({ id: 1.5 }), /whole number/);
  assert.deepEqual(changes, [
    { action: "remember", id: 1, count: 1 },
    { action: "forget", id: 1, count: 0 },
  ]);
  assert.ok(!JSON.stringify(changes).includes("birthday"));
});

test("secrets are refused", () => {
  const store = openMemoryStore({ path: ":memory:" });
  const [remember] = createMemoryTools({ store, provenance: () => voice });
  for (const secret of ["My password is hunter2", "card 4111 1111 1111 1111", "key sk-abcdefghijklmnop1234", "the PIN is 4821"]) {
    assert.ok(looksSecret(secret), secret);
    assert.throws(() => remember.run({ fact: secret }), /secret/);
  }
  assert.equal(store.count(), 0);
  assert.ok(!looksSecret("Keshab's favourite number is 7."));
});

test("clear deletes every memory of this owner only", () => {
  const store = openMemoryStore({ path: ":memory:" });
  store.add("one", voice);
  store.add("two", voice);
  assert.equal(store.clear(), 2);
  assert.equal(store.count(), 0);
  assert.deepEqual(store.search("one two"), []);
  assert.equal(store.clear(), 0);
});

// --- episodes (ADR-059) ---

import { createEpisodeRecorder, episodeContext, SUMMARY_PROMPT } from "./index.ts";
import type { LanguageModel, Message, ModelRequest } from "@zeno/contracts";

const convo = (n: number): Message[] =>
  Array.from({ length: n }, (_, i) => [
    { role: "user" as const, content: `question ${i + 1}` },
    { role: "assistant" as const, content: `answer ${i + 1}` },
  ]).flat();

test("an episode per session is updated in place; the oldest are pruned", () => {
  const store = openMemoryStore({ path: ":memory:", maxEpisodes: 2, now: clock() });
  store.saveEpisode("s1", "The user planned a trip.", 1);
  const updated = store.saveEpisode("s1", "The user planned a trip to Osaka in May.", 3);
  assert.equal(store.episodeCount(), 1);
  assert.equal(updated.summary, "The user planned a trip to Osaka in May.");
  assert.equal(updated.exchanges, 3);
  store.saveEpisode("s2", "Second.", 1);
  store.saveEpisode("s3", "Third.", 1);
  assert.deepEqual(store.episodes().map((e) => e.sessionId), ["s3", "s2"]);
  assert.throws(() => store.saveEpisode("s4", "   ", 1), MemoryError);
  assert.equal(store.saveEpisode("s5", "x".repeat(900), 1).summary.length, 400);
  assert.equal(store.clearEpisodes(), 2);
});

test("episodes and memories are deleted separately", () => {
  const store = openMemoryStore({ path: ":memory:" });
  store.add("A fact.", voice);
  const e = store.saveEpisode("s1", "A conversation.", 1);
  store.clear();
  assert.equal(store.episodeCount(), 1);
  assert.equal(store.removeEpisode(e.id), true);
  assert.equal(store.removeEpisode(e.id), false);
});

function fakeSummariser(reply: (req: ModelRequest) => string | Promise<string>) {
  const requests: ModelRequest[] = [];
  const model: LanguageModel = {
    async complete(request) {
      requests.push(request);
      return { text: await reply(request) };
    },
  };
  return { model, requests };
}

test("recorder: summarises in the background with no tools, keeps only the newest, skips NOTHING", async () => {
  const store = openMemoryStore({ path: ":memory:" });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { model, requests } = fakeSummariser(async (req) => {
    if (requests.length === 1) await gate; // the first summary is slow
    return `Summary of ${req.messages[0].content.split("\n").length - 1} lines`;
  });
  const saved: unknown[] = [];
  const recorder = createEpisodeRecorder({ store, model, onSaved: (e) => saved.push(e) });
  recorder.update("s1", convo(1));
  await new Promise((r) => setTimeout(r, 1)); // the first summary is now running
  recorder.update("s1", convo(2)); // queued
  recorder.update("s1", convo(3)); // replaces the queued one
  release();
  await recorder.idle();
  assert.equal(requests.length, 2, "the middle update was superseded");
  for (const r of requests) {
    assert.equal(r.system, SUMMARY_PROMPT);
    assert.equal(r.tools, undefined, "the summariser can never use tools");
  }
  assert.equal(store.episodes()[0].summary, "Summary of 6 lines");
  assert.equal(store.episodes()[0].exchanges, 3);
  assert.equal(saved.length, 2);
  assert.ok(!JSON.stringify(saved).includes("Summary"), "the log gets ids and counts only");

  const quiet = createEpisodeRecorder({ store: openMemoryStore({ path: ":memory:" }), model: fakeSummariser(() => "NOTHING").model });
  quiet.update("s9", convo(1));
  await quiet.idle();
});

test("recorder: a failing model is reported, never thrown; an empty session is skipped", async () => {
  const store = openMemoryStore({ path: ":memory:" });
  const errors: unknown[] = [];
  const model: LanguageModel = { complete: async () => Promise.reject(new Error("quota")) };
  const recorder = createEpisodeRecorder({ store, model, onError: (e) => errors.push(e) });
  recorder.update("s1", []);
  recorder.update("s1", convo(1));
  await recorder.idle();
  assert.equal(errors.length, 1);
  assert.equal(store.episodeCount(), 0);
});

test("episode context: newest few, oldest first, never the current session", () => {
  const store = openMemoryStore({ path: ":memory:", now: clock() });
  assert.equal(episodeContext(store, "now"), undefined);
  for (const s of ["a", "b", "c", "d", "now"]) store.saveEpisode(s, `Talked about ${s}.`, 1);
  const block = episodeContext(store, "now", 3)!;
  const lines = block.split("\n").slice(1);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Talked about b\./);
  assert.match(lines[2], /Talked about d\./);
  assert.ok(!block.includes("about now"));
});

test("each memory tool says what can be asked of it, under one title (ADR-076)", () => {
  const tools = createMemoryTools({ store: openMemoryStore({ path: ":memory:" }), provenance: () => voice });
  assert.deepEqual([...new Set(tools.map((t) => t.capability.title))], ["Remember things"]);
  assert.equal(new Set(tools.flatMap((t) => t.capability.examples)).size, 3);
});
