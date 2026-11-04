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
