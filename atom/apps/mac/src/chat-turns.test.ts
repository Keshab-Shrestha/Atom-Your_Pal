import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatTurns } from "./chat-turns.ts";

// 2026-10-16: the window and the phone share a chat; two turns at once in it overwrote each other's messages.

test("a second turn in a chat that is answering is refused with a line that names who answers; another chat is free", () => {
  const turns = createChatTurns();
  assert.equal(turns.begin("api-x", "api"), undefined);
  assert.match(turns.begin("api-x", "window") ?? "", /^The phone or the Local API is answering in this chat\. Try again in a moment\.$/);
  assert.equal(turns.begin("other", "window"), undefined, "another chat is not blocked");
  turns.end("api-x", "api");
  assert.equal(turns.begin("api-x", "window"), undefined, "free after the turn ended");
  assert.match(turns.begin("api-x", "api") ?? "", /^The ATOM window is answering/);
  turns.end("api-x", "api"); // ending for the wrong surface changes nothing
  assert.ok(turns.begin("api-x", "api"), "still the window's turn");
});

test("a chat deleted during a turn is marked, a chat deleted with no turn is not, and a new turn clears the mark", () => {
  const turns = createChatTurns();
  turns.markDeleted("quiet");
  assert.equal(turns.wasDeleted("quiet"), false, "no turn was running: nothing to guard");
  turns.begin("busy", "window");
  turns.markDeleted("busy");
  assert.equal(turns.wasDeleted("busy"), true);
  turns.end("busy", "window");
  assert.equal(turns.wasDeleted("busy"), true, "the final save of the turn that just ended is still skipped");
  turns.begin("busy", "window");
  assert.equal(turns.wasDeleted("busy"), false, "a new turn in the same chat starts it again");
});
