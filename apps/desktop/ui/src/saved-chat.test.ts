import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRST, historyWhy, kb, latestCursor, partLabel } from "./saved-chat.ts";

test("the latest page starts seven messages before the end, and never before the first", () => {
  assert.deepEqual(latestCursor(20), { message: 13, offset: 0 });
  assert.deepEqual(latestCursor(8), { message: 1, offset: 0 });
  assert.deepEqual(latestCursor(2), FIRST);
  assert.deepEqual(latestCursor(0), FIRST);
});

test("saved history is readable only for a saved chat, once ATOM is ready", () => {
  assert.equal(historyWhy({ messages: 3 }, true), undefined);
  assert.match(historyWhy({ messages: 3 }, false)!, /not ready/);
  assert.match(historyWhy(undefined, true)!, /no saved chat/);
  assert.match(historyWhy({ messages: 0 }, true)!, /not saved yet/);
});

test("a part says which message it is, who wrote it, and where a continued message resumes", () => {
  assert.equal(partLabel({ seq: 3, role: "assistant", offset: 0 }), "Message 3 · ATOM");
  assert.equal(partLabel({ seq: 1, role: "user", offset: 0 }), "Message 1 · You");
  assert.equal(partLabel({ seq: 4, role: "assistant", offset: 7000 }), "Message 4 · ATOM · continues from character 7000");
});

test("bytes are shown as kilobytes", () => {
  assert.equal(kb(0), "0.0 KB");
  assert.equal(kb(12_345), "12.3 KB");
});
