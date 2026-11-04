import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryStore } from "./index.ts";

// 2026-11-04 (Keshab: "make sure chat auto remembers, no need for asking"): noticed facts are kept at once.
test("remember keeps each noticed fact at once, skips secrets, repeats and refused ones, and leaves nothing waiting", () => {
  const store = openMemoryStore({ path: ":memory:" });
  const kept = store.suggestions.remember(["Keshab prefers window seats.", "His wifi password is hunter2hunter2.", "keshab  PREFERS window seats", ""], "chat-1");
  assert.deepEqual(kept.map((m) => m.text), ["Keshab prefers window seats."]);
  assert.equal(store.count(), 1);
  assert.deepEqual(store.suggestions.pending(), [], "nothing waits for an answer");
  assert.deepEqual(store.suggestions.remember(["Keshab prefers window seats."], "chat-2"), [], "a fact already kept is not kept again");
  store.close?.();
});

test("a fact the user refused before is never kept by itself", () => {
  const store = openMemoryStore({ path: ":memory:" });
  const [suggestion] = store.suggestions.suggest(["Keshab dislikes mornings."], "chat-1");
  assert.equal(store.suggestions.deny(suggestion!.id), true);
  assert.deepEqual(store.suggestions.remember(["Keshab dislikes mornings."], "chat-2"), []);
  assert.equal(store.count(), 0);
  store.close?.();
});

test("a fact that fails a check waits as a suggestion instead of being lost", () => {
  const store = openMemoryStore({ path: ":memory:", maxMemories: 1 });
  store.add("One fact fills memory.", { source: "text" });
  assert.deepEqual(store.suggestions.remember(["A second fact does not fit."], "chat-1"), []);
  assert.deepEqual(store.suggestions.pending().map((s) => s.text), ["A second fact does not fit."]);
  store.close?.();
});

// 2026-11-04: a kept fact leaves a receipt with Undo; Undo and Forget both block the text for good.
test("undo forgets a kept fact and blocks it; only a recent receipt can be undone", () => {
  let clock = new Date("2026-11-04T10:00:00Z");
  const store = openMemoryStore({ path: ":memory:", now: () => clock });
  const [fact] = store.suggestions.remember(["Keshab prefers window seats."], "chat-1");
  assert.deepEqual(store.suggestions.kept(), [{ id: fact!.id, text: fact!.text }]);
  assert.equal(store.suggestions.undo(fact!.id), true);
  assert.equal(store.count(), 0);
  assert.deepEqual(store.suggestions.kept(), []);
  assert.deepEqual(store.suggestions.remember(["Keshab prefers window seats."], "chat-2"), [], "blocked after undo");
  assert.equal(store.suggestions.undo(fact!.id), false, "no receipt any more");
  const [other] = store.suggestions.remember(["Keshab lives in Tokyo."], "chat-3");
  clock = new Date("2026-11-04T10:11:00Z");
  assert.deepEqual(store.suggestions.kept(), [], "a receipt expires after 10 minutes");
  assert.equal(store.suggestions.undo(other!.id), false);
  store.close?.();
});

test("block keeps a forgotten fact from coming back by itself", () => {
  const store = openMemoryStore({ path: ":memory:" });
  store.suggestions.block("Keshab dislikes mornings.");
  assert.deepEqual(store.suggestions.remember(["keshab dislikes MORNINGS"], "chat-1"), []);
  store.close?.();
});
