import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CHAT_TITLE_LENGTH, createMemoryTools, ftsQuery, looksSecret, memoryContext, MemoryError, openMemoryStore, MAX_MEMORY_CHARS } from "./index.ts";

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

test("keeps long text, refuses empty and more than the item limit; never drops old memories silently", () => {
  const store = openMemoryStore({ path: ":memory:", maxMemories: 2 });
  assert.throws(() => store.add("   ", voice), MemoryError);
  assert.equal(store.add("x".repeat(6000), voice).text.length, 6000);
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
  const dir = mkdtempSync(join(tmpdir(), "atom-mem-"));
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
  const dir = mkdtempSync(join(tmpdir(), "atom-mem-"));
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

import { createEpisodeRecorder, episodeContext, noteQuietMs, NOTE_QUIET_MS, SUMMARY_PROMPT } from "./index.ts";
import type { LanguageModel, Message, ModelRequest } from "@atom/contracts";

const convo = (n: number): Message[] =>
  Array.from({ length: n }, (_, i) => [
    { role: "user" as const, content: `question ${i + 1}` },
    { role: "assistant" as const, content: `answer ${i + 1}` },
  ]).flat();

test("an episode per session is updated in place; the oldest are pruned", () => {
  const store = openMemoryStore({ path: ":memory:", maxEpisodes: 2, now: clock() });
  store.saveEpisode("s1", "The user planned a trip.", 1);
  const updated = store.saveEpisode("s1", "The user planned a trip to Osaka in May.", 3);
  assert.equal(store.episodes().length, 1);
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
  assert.equal(store.episodes().length, 1);
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
  const recorder = createEpisodeRecorder({ store, model, quietMs: 0, onSaved: (e) => saved.push(e) });
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

  const quiet = createEpisodeRecorder({ store: openMemoryStore({ path: ":memory:" }), model: fakeSummariser(() => "NOTHING").model, quietMs: 0 });
  quiet.update("s9", convo(1));
  await quiet.idle();
});

test("recorder: a failing model is reported, never thrown; an empty session is skipped", async () => {
  const store = openMemoryStore({ path: ":memory:" });
  const errors: unknown[] = [];
  const model: LanguageModel = { complete: async () => Promise.reject(new Error("quota")) };
  const recorder = createEpisodeRecorder({ store, model, quietMs: 0, onError: (e) => errors.push(e) });
  recorder.update("s1", []);
  recorder.update("s1", convo(1));
  await recorder.idle();
  assert.equal(errors.length, 1);
  assert.equal(store.episodes().length, 0);
});

// --- ADR-108: one note when a chat goes quiet or is left ---

const MINUTE = 60_000;
const tick = () => new Promise<void>((r) => setImmediate(r));

test("recorder: the note waits for a quiet chat; each reply restarts the wait; the whole chat is noted once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = openMemoryStore({ path: ":memory:" });
  const { model, requests } = fakeSummariser(() => "A note.");
  const recorder = createEpisodeRecorder({ store, model });
  recorder.update("s1", convo(2));
  t.mock.timers.tick(9 * MINUTE);
  recorder.update("s1", convo(3)); // restarts the wait
  t.mock.timers.tick(9 * MINUTE);
  await recorder.idle();
  assert.equal(requests.length, 0, "not yet quiet for 10 minutes");
  t.mock.timers.tick(1 * MINUTE);
  await recorder.idle();
  assert.equal(requests.length, 1, "one request, not one per reply");
  assert.equal(requests[0].messages[0].content.split("\n").length - 1, 6, "it covers the whole chat");
  assert.equal(requests[0].system, SUMMARY_PROMPT);
  assert.equal(store.episodes()[0].exchanges, 3);
  t.mock.timers.tick(60 * MINUTE);
  await recorder.idle();
  assert.equal(requests.length, 1, "a noted chat is not noted again");
});

test("recorder: flush writes a chat's note at once; a chat that was not changed is not noted again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = openMemoryStore({ path: ":memory:" });
  const { model, requests } = fakeSummariser(() => "A note.");
  const recorder = createEpisodeRecorder({ store, model });
  recorder.update("old", convo(2));
  recorder.update("other", convo(2));
  await recorder.flush("old");
  assert.equal(requests.length, 1);
  assert.equal(store.episodes()[0].sessionId, "old");
  await recorder.flush("old");
  assert.equal(requests.length, 1, "nothing new in that chat");
  t.mock.timers.tick(10 * MINUTE);
  await recorder.idle();
  assert.equal(requests.length, 2, "the other chat still waited for its own quiet time");
  recorder.update("old", convo(3));
  await recorder.flush(); // quitting: every waiting chat
  assert.equal(requests.length, 3);
  assert.equal(store.episodes().find((e) => e.sessionId === "old")!.exchanges, 3);
});

test("recorder: a chat with one exchange gets no note; a deleted chat gets none; read-only and project chats are chats like others", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = openMemoryStore({ path: ":memory:" });
  const { model, requests } = fakeSummariser(() => "A note.");
  const recorder = createEpisodeRecorder({ store, model });
  recorder.update("short", convo(1));
  recorder.update("gone", convo(2));
  recorder.update("telegram", convo(2)); // a read-only chat: its own surface keeps writing to it
  recorder.update("project-chat", convo(4)); // a project chat: the same note, keyed by its chat id
  recorder.discard("gone");
  await recorder.flush();
  assert.deepEqual(requests.map((r) => r.context.sessionId).sort(), ["project-chat", "telegram"]);
  assert.ok(requests.every((r) => r.context.background === true), "a note never joins the chat's session");
  assert.deepEqual(store.episodes().map((e) => e.sessionId).sort(), ["project-chat", "telegram"]);
  t.mock.timers.tick(60 * MINUTE);
  await recorder.idle();
  assert.equal(requests.length, 2);
  await tick();
});

test("recorder: quietMs 0 notes after every reply, as before ADR-108; a bad ATOM_NOTE_QUIET_MS is the default", async () => {
  const store = openMemoryStore({ path: ":memory:" });
  const { model, requests } = fakeSummariser(() => "A note.");
  const recorder = createEpisodeRecorder({ store, model, quietMs: 0 });
  recorder.update("s1", convo(1));
  await recorder.idle();
  recorder.update("s1", convo(2));
  await recorder.idle();
  assert.equal(requests.length, 2);
  assert.deepEqual([noteQuietMs(undefined), noteQuietMs(""), noteQuietMs("abc"), noteQuietMs("-5"), noteQuietMs("0"), noteQuietMs("1500")], [NOTE_QUIET_MS, NOTE_QUIET_MS, NOTE_QUIET_MS, NOTE_QUIET_MS, 0, 1500]);
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

test("chats are saved per session with a title from their first words, listed newest first, read and removed (ADR-091)", () => {
  let clock = new Date("2026-10-11T00:00:00Z");
  const store = openMemoryStore({ path: ":memory:", now: () => clock });
  store.chats.save("a", [{ role: "user", content: "  Plan my\n trip to Tokyo in spring with a long title that goes past sixty characters easily" }, { role: "assistant", content: "Sure." }]);
  clock = new Date("2026-10-11T01:00:00Z");
  store.chats.save("b", [{ role: "user", content: "Weather?" }, { role: "assistant", content: "Sunny." }]);
  store.chats.save("empty", []);
  const list = store.chats.list();
  assert.deepEqual(list.map((c) => [c.id, c.messages]), [["b", 2], ["a", 2]]);
  assert.ok(list[1]!.title.startsWith("Plan my trip to Tokyo") && list[1]!.title.length <= CHAT_TITLE_LENGTH && list[1]!.title.endsWith("…"));
  clock = new Date("2026-10-11T02:00:00Z");
  store.chats.save("a", [{ role: "user", content: "Plan my trip" }, { role: "assistant", content: "Sure." }, { role: "user", content: "Tokyo" }, { role: "assistant", content: "Great." }]);
  assert.deepEqual(store.chats.list().map((c) => c.id), ["a", "b"], "a saved exchange moves it to the top");
  assert.deepEqual(store.chats.messages("a").map((m) => m.content), ["Plan my trip", "Sure.", "Tokyo", "Great."]);
  assert.ok(store.chats.remove("a") && !store.chats.remove("a"));
  assert.deepEqual([store.chats.messages("a"), store.chats.list().map((c) => c.id)], [[], ["b"]]);
});

// 2026-10-16 (review): String(input.fact) turned a missing fact into the text "undefined", which was kept as a real memory.
test("remember refuses a missing or empty fact instead of keeping the word 'undefined'", () => {
  const store = openMemoryStore({ path: ":memory:" });
  const [remember] = createMemoryTools({ store, provenance: () => ({ source: "text" }) });
  for (const input of [{}, { fact: undefined }, { fact: null }, { fact: "   " }, { fact: 42 }, { fact: ["a"] }]) {
    assert.throws(() => remember!.run(input as never), /what to remember/i, JSON.stringify(input));
  }
  assert.equal(store.count(), 0);
  assert.match(String(remember!.run({ fact: "  My sister lives in Oslo  " } as never)), /Kept as memory/);
  assert.equal(store.get(1)?.text, "My sister lives in Oslo", "trimmed");
});

// Memory upkeep: expiry, replacement, duplicate folding and undo. Idea from OpenMausBot `docs/memory.md` (Apache-2.0).
function steppedClock(start = "2026-10-04T09:00:00Z") {
  let t = Date.parse(start);
  return { now: () => new Date(t), advanceDays: (days: number) => void (t += days * 86_400_000) };
}

test("a fact with an end date is recalled until that date, then hidden but still findable by id", () => {
  const clk = steppedClock();
  const store = openMemoryStore({ path: ":memory:", now: clk.now });
  const trip = store.add("Keshab is in Kyoto this week.", voice, { until: new Date("2026-10-08T23:59:59.999Z") });
  store.add("Keshab drinks green tea.", voice);
  assert.equal(trip.expiresAt?.toISOString(), "2026-10-08T23:59:59.999Z");
  assert.equal(store.count(), 2);
  clk.advanceDays(5);
  assert.deepEqual(store.recent().map((m) => m.text), ["Keshab drinks green tea."]);
  assert.deepEqual(store.search("Kyoto"), []);
  assert.equal(store.count(), 1, "an expired fact does not use a slot");
  assert.equal(store.get(trip.id)?.text, "Keshab is in Kyoto this week.", "a receipt can still read it");
  assert.notEqual(store.add("Keshab is in Kyoto this week.", voice).id, trip.id, "the same words later are a new fact");
  assert.throws(() => store.add("Past.", voice, { until: new Date("2026-10-01T00:00:00Z") }), /not in the future/);
});

test("supersede hides the old fact, keeps it for undo, and fits at the memory limit", () => {
  const store = openMemoryStore({ path: ":memory:", maxMemories: 1, now: clock() });
  const old = store.add("Keshab lives in Pune.", voice);
  const now = store.supersede(old.id, "Keshab lives in Oslo.", voice);
  assert.deepEqual(store.recent().map((m) => m.id), [now.id]);
  assert.deepEqual(store.search("Pune"), []);
  assert.equal(store.count(), 1);
  assert.deepEqual(store.journal().map((c) => [c.action, c.memoryId, c.replacedBy, c.undone]), [["supersede", old.id, now.id, false]]);
  assert.ok(!JSON.stringify(store.journal()).includes("Oslo"), "the journal holds ids, never fact text");

  const undone = store.undo();
  assert.equal(undone?.undone, true);
  assert.deepEqual(store.recent().map((m) => m.id), [old.id], "the old fact is back and the new one is gone");
  assert.equal(store.get(now.id), undefined);
  assert.equal(store.undo(), undefined, "nothing is left to undo");
});

test("supersede refuses the same fact and a fact that is not kept; undo never deletes a fact that already existed", () => {
  const store = openMemoryStore({ path: ":memory:", now: clock() });
  const a = store.add("Keshab likes tea.", voice);
  const b = store.add("Keshab likes coffee.", voice);
  assert.throws(() => store.supersede(a.id, "keshab likes TEA.", voice), /same fact/);
  assert.throws(() => store.supersede(99, "Anything.", voice), /not kept/);
  store.supersede(a.id, "Keshab likes coffee.", voice);
  assert.deepEqual(store.recent().map((m) => m.id), [b.id]);
  store.undo();
  assert.deepEqual(store.recent().map((m) => m.id).sort(), [a.id, b.id], "b was kept before the change, so undo keeps it");
  store.remove(a.id);
  assert.throws(() => store.supersede(a.id, "Gone.", voice), /not kept/);
});

test("tidy hides facts that differ only in case, spacing or a final full stop; the newest stands; undo reverses in order", () => {
  const store = openMemoryStore({ path: ":memory:", now: clock() });
  const first = store.add("Keshab lives in Oslo", voice);
  const second = store.add("keshab  lives in oslo.", voice);
  const third = store.add("Keshab lives in Oslo。", voice);
  store.add("Keshab drinks tea.", voice);
  assert.equal(store.tidy(), 2);
  assert.deepEqual(store.recent().map((m) => m.text).reverse(), ["Keshab lives in Oslo。", "Keshab drinks tea."]);
  assert.equal(store.tidy(), 0, "a second pass finds nothing");
  assert.equal(store.journal().filter((c) => c.action === "fold").length, 2);
  store.undo();
  store.undo();
  assert.deepEqual(store.recent(10).map((m) => m.id).sort(), [first.id, second.id, third.id, 4].sort());
});

test("forgetting stays final: it deletes the row even after a replacement", () => {
  const store = openMemoryStore({ path: ":memory:", now: clock() });
  const old = store.add("Keshab lives in Pune.", voice);
  const now = store.supersede(old.id, "Keshab lives in Oslo.", voice);
  store.remove(now.id);
  assert.equal(store.get(now.id), undefined);
  assert.equal(store.search("Oslo").length, 0);
});

test("a database made before expiry and replacement existed is upgraded in place and keeps its facts", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-memory-"));
  try {
    const path = join(dir, "memory.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, owner TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'personal', source TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL)");
    old.prepare("INSERT INTO memories (text, owner, source, created_at) VALUES (?, 'local', 'text', ?)").run("Keshab likes tea.", "2026-10-01T00:00:00.000Z");
    old.close();
    const store = openMemoryStore({ path });
    assert.deepEqual(store.recent().map((m) => m.text), ["Keshab likes tea."]);
    assert.equal(store.supersede(1, "Keshab likes coffee.", voice).text, "Keshab likes coffee.");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tools: remember with until and replaces; a bad date or id is refused; recall shows the end date", () => {
  const store = openMemoryStore({ path: ":memory:", now: steppedClock().now });
  const [remember, recall] = createMemoryTools({ store, provenance: () => ({ source: "text" }) });
  assert.match(String(remember!.run({ fact: "Keshab is in Kyoto.", until: "2026-10-08" } as never)), /Kept as memory 1/);
  assert.match(String(recall!.run({} as never)), /until 2026-10-08/);
  for (const until of ["next week", "2026-02-31", "2026-13-01", 5]) {
    assert.throws(() => remember!.run({ fact: "Bad date.", until } as never), /real day/, String(until));
  }
  assert.match(String(remember!.run({ fact: "Keshab is in Osaka.", replaces: 1 } as never)), /Kept as memory 2, replacing memory 1/);
  assert.deepEqual(store.recent().map((m) => m.id), [2]);
  assert.throws(() => remember!.run({ fact: "X.", replaces: 0 } as never), /whole number/);
  assert.throws(() => remember!.run({ fact: "X.", replaces: 1 } as never), /not kept/, "memory 1 is already replaced");
});

// 2026-10-16 (code check): any run of 13 to 19 digits was refused as a card number, so an international phone number could not be remembered.
test("looksSecret refuses a card number (Luhn) but not a long phone number", () => {
  assert.equal(looksSecret("my card is 4111 1111 1111 1111"), true);
  assert.equal(looksSecret("card 4111-1111-1111-1111 exp 12/29"), true);
  assert.equal(looksSecret("Keshab's number is +977 9812345678"), false, "13 digits after a plus");
  assert.equal(looksSecret("call 00977 9812345678"), false, "does not pass the Luhn check");
  assert.equal(looksSecret("password is hunter2"), true);
});
