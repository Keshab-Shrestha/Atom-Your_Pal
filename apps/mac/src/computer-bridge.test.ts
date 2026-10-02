import { test } from "node:test";
import assert from "node:assert/strict";
import type { IslandEvent } from "./island-protocol.ts";
import { createComputerBridge, stepText } from "./computer-bridge.ts";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function setup(over: { timeoutMs?: number } = {}) {
  const events: IslandEvent[] = [];
  let n = 0;
  const bridge = createComputerBridge({ timeoutMs: over.timeoutMs ?? 5000, newId: () => `a${++n}` });
  bridge.attach((e) => events.push(e));
  return { bridge, events };
}
const req = { summary: 'Click "Send" in Mail', reason: "it may send" };

test("a request goes to the island and resolves with the user's answer", async () => {
  const { bridge, events } = setup();
  const answer = bridge.approve(req);
  assert.deepEqual(events, [{ type: "approval.request", id: "a1", summary: 'Click "Send" in Mail', reason: "it may send" }]);
  bridge.answer("a1", true);
  assert.equal(await answer, true);
  assert.deepEqual(events[1], { type: "approval.closed", id: "a1" });
});

test("declining resolves false", async () => {
  const { bridge } = setup();
  const answer = bridge.approve(req);
  bridge.answer("a1", false);
  assert.equal(await answer, false);
});

test("no island attached means no", async () => {
  const bridge = createComputerBridge({ newId: () => "x" });
  assert.equal(await bridge.approve(req), false);
});

test("an answer for an unknown or already-answered id changes nothing", async () => {
  const { bridge, events } = setup();
  bridge.answer("nope", true);
  const answer = bridge.approve(req);
  bridge.answer("a1", false);
  bridge.answer("a1", true); // too late
  assert.equal(await answer, false);
  assert.equal(events.filter((e) => e.type === "approval.closed").length, 1);
});

test("no answer in time is a no, and the island is told to drop the prompt", async () => {
  const { bridge, events } = setup({ timeoutMs: 30 });
  assert.equal(await bridge.approve(req), false);
  assert.deepEqual(events[events.length - 1], { type: "approval.closed", id: "a1" });
});

test("cancelling the turn declines the request and closes the prompt", async () => {
  const { bridge, events } = setup();
  const ac = new AbortController();
  const answer = bridge.approve(req, ac.signal);
  ac.abort();
  assert.equal(await answer, false);
  assert.deepEqual(events[events.length - 1], { type: "approval.closed", id: "a1" });
});

test("an already-cancelled turn never shows a prompt", async () => {
  const { bridge, events } = setup();
  const ac = new AbortController();
  ac.abort();
  assert.equal(await bridge.approve(req, ac.signal), false);
  assert.equal(events.length, 0);
});

test("cancelAll declines everything waiting", async () => {
  const { bridge, events } = setup();
  const a = bridge.approve(req);
  bridge.cancelAll();
  assert.equal(await a, false);
  assert.equal(events.filter((e) => e.type === "approval.closed").length, 1);
});

test("an approval cannot be answered by a later request's id", async () => {
  const { bridge } = setup();
  const first = bridge.approve(req);
  bridge.answer("a1", false);
  await first;
  const second = bridge.approve(req);
  bridge.answer("a1", true); // the old id must not approve the new request
  bridge.answer("a2", false);
  assert.equal(await second, false);
});

test("the wording shown to the user is one short line", async () => {
  const { bridge, events } = setup();
  const p = bridge.approve({ summary: "Click \"Send\"\n\n  in   Mail " + "x".repeat(400), reason: "line one\nline two" });
  bridge.answer("a1", false);
  await p;
  const e = events[0] as Extract<IslandEvent, { type: "approval.request" }>;
  assert.doesNotMatch(e.summary, /\n/);
  assert.doesNotMatch(e.summary, / {2}/);
  assert.ok(e.summary.length <= 140);
  assert.doesNotMatch(e.reason, /\n/);
});

test("steps are sent as plain words, never with typed text", () => {
  const { bridge, events } = setup();
  bridge.step({ action: "type", app: "TextEdit" });
  assert.deepEqual(events, [{ type: "computer.step", text: "Typing in TextEdit" }]);
});

test("stepText covers every action and tolerates a missing app", () => {
  assert.equal(stepText({ action: "look", app: "Mail" }), "Looking at Mail");
  assert.equal(stepText({ action: "click", app: "Mail" }), "Clicking in Mail");
  assert.equal(stepText({ action: "key", app: "Mail" }), "Pressing a key in Mail");
  assert.equal(stepText({ action: "scroll", app: "Safari" }), "Scrolling in Safari");
  assert.equal(stepText({ action: "open", app: "Notes" }), "Opening Notes");
  assert.equal(stepText({ action: "list_apps" }), "Checking which apps are open");
  assert.equal(stepText({ action: "click" }), "Clicking");
  assert.equal(stepText({ action: "nonsense" }), "Using the computer");
  assert.ok(stepText({ action: "look", app: "x".repeat(300) }).length < 80);
});
