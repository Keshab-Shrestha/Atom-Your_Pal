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
