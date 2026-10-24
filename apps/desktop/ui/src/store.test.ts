import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce, sendBlock, type Action, type AppState } from "./store.ts";

const ev = (event: object): Action => ({ kind: "event", event: event as never });
const run = (actions: Action[], from: AppState = initialState) => actions.reduce(reduce, from);

const ready = ev({ type: "ready", protocol: 1, provider: "claude", model: "Claude Sonnet 5.5", microphone: "x", voice: false });
const chats = ev({ type: "chats", current: "c1", chats: [{ id: "c1", title: "One", updatedAt: "2026-10-24T00:00:00Z", messages: 0 }, { id: "c2", title: "Two", updatedAt: "2026-10-23T00:00:00Z", messages: 0, readOnly: true }] });

test("a typed turn adds the user's text and the reply in order, with distinct ids", () => {
  const s = run([ev({ type: "chat.opened", id: "c1", messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] }), ev({ type: "transcript", text: "next" }), ev({ type: "reply", text: "ok" })]);
  assert.deepEqual(s.messages.map((m) => [m.role, m.text]), [["user", "hi"], ["assistant", "hello"], ["user", "next"], ["assistant", "ok"]]);
  assert.equal(new Set(s.messages.map((m) => m.id)).size, 4);
});

test("opening a chat replaces the shown turns and records which chat is open", () => {
  const s = run([ev({ type: "transcript", text: "old" }), ev({ type: "chat.opened", id: "c2", messages: [{ role: "assistant", text: "only reply" }] })]);
  assert.equal(s.openChatId, "c2");
  assert.deepEqual(s.messages.map((m) => m.text), ["only reply"]);
});

test("a new conversation clears the turns until the chats list names the new chat", () => {
  const s = run([ev({ type: "chat.opened", id: "c1", messages: [{ role: "user", text: "x" }] }), ev({ type: "conversation.reset" })]);
  assert.deepEqual(s.messages, []);
  assert.equal(s.openChatId, undefined);
});

test("a model error ends the thinking state and keeps its words; a notice has no stage", () => {
  const thinking = run([ev({ type: "state", state: "thinking" })]);
  assert.equal(thinking.loop, "thinking");
  const failed = reduce(thinking, ev({ type: "error", stage: "model", message: "No internet." }));
  assert.equal(failed.loop, "idle");
  assert.deepEqual(failed.problem, { stage: "model", message: "No internet." });
  const note = reduce(initialState, ev({ type: "notice", kind: "no_speech", message: "Speak closer." }));
  assert.deepEqual(note.problem, { message: "Speak closer." });
});

test("when the runtime stops, the turn in flight and the ready data are forgotten", () => {
  const live = run([ready, ev({ type: "state", state: "speaking" }), { kind: "runtime", status: { state: "running", pid: 1 } }]);
  assert.equal(live.ready?.model, "Claude Sonnet 5.5");
  const down = reduce(live, { kind: "runtime", status: { state: "restarting", afterSeconds: 2 } });
  assert.equal(down.ready, undefined);
  assert.equal(down.loop, "idle");
});

test("sending is blocked, with a reason, until the link, runtime and ready event are all there", () => {
  assert.match(sendBlock(initialState)!, /lost its connection/);
  const linked = run([{ kind: "link", link: "live" }, { kind: "runtime", status: { state: "running", pid: 1 } }, chats]);
  assert.equal(sendBlock(linked), "ATOM is starting.");
  assert.equal(sendBlock(reduce(linked, ready)), undefined);
  const restarting = reduce(linked, { kind: "runtime", status: { state: "restarting", afterSeconds: 4 } });
  assert.match(sendBlock(restarting)!, /restarts in 4 s/);
  const config = reduce(linked, { kind: "runtime", status: { state: "configError", message: "ATOM_ANTHROPIC_API_KEY is missing." } });
  assert.equal(sendBlock(config), "ATOM_ANTHROPIC_API_KEY is missing.");
});

test("a chat written by another surface cannot be typed into", () => {
  const s = run([{ kind: "link", link: "live" }, { kind: "runtime", status: { state: "running", pid: 1 } }, ready, ev({ type: "chats", current: "c2", chats: [{ id: "c2", title: "Telegram", updatedAt: "2026-10-23T00:00:00Z", messages: 1, readOnly: true }] })]);
  assert.match(sendBlock(s)!, /Telegram or the local API/);
});

test("events for screens that are not ported yet change nothing", () => {
  assert.equal(reduce(initialState, ev({ type: "mic.level", peak: 0.4 })), initialState);
});
