import { test } from "node:test";
import assert from "node:assert/strict";
import type { IslandEvent } from "./island-protocol.ts";
import { createComputerBridge, stepText } from "./computer-bridge.ts";

function setup(over: { timeoutMs?: number } = {}) {
  const events: IslandEvent[] = [];
  let n = 0;
  const bridge = createComputerBridge({ timeoutMs: over.timeoutMs ?? 5000, newId: () => `a${++n}` });
  bridge.attach((e) => events.push(e));
  return { bridge, events };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 2026-10-15: the island's strip ended only when its voice loop went idle; an API turn left it up until the user closed it.
test("a quiet moment after the last step tells the island the work is over; a new step moves the end later", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events: IslandEvent[] = [];
  const bridge = createComputerBridge({ endAfterMs: 40 });
  bridge.attach((e) => events.push(e));
  bridge.step({ action: "look", app: "TextEdit" });
  t.mock.timers.tick(25);
  bridge.step({ action: "type", app: "TextEdit" });
  t.mock.timers.tick(25);
  assert.deepEqual(events.map((e) => e.type), ["computer.step", "computer.step"], "not yet: the second step moved the end");
  t.mock.timers.tick(40);
  assert.deepEqual(events.map((e) => e.type), ["computer.step", "computer.step", "computer.end"]);
});

test("the end waits for an approval and comes after it is answered", async () => {
  const events: IslandEvent[] = [];
  const bridge = createComputerBridge({ endAfterMs: 20, newId: () => "a1" });
  bridge.attach((e) => events.push(e));
  bridge.step({ action: "click", app: "Mail" });
  const answer = bridge.approve({ summary: "Click Send", reason: "it may send" });
  await sleep(60);
  assert.ok(!events.some((e) => e.type === "computer.end"), "an approval is waiting: the work is not over");
  bridge.answer("a1", true);
  await answer;
  await sleep(40);
  assert.equal(events.at(-1)?.type, "computer.end");
});

const req = { summary: 'Click "Send" in Mail', reason: "it may send" };

test("remembering file access needs the explicit file-only choice; ordinary Allow stays one time", async () => {
  const { bridge, events } = setup();
  const once = bridge.approveFile(req);
  assert.equal(events[0]?.type === "approval.request" && events[0].rememberFile, true);
  bridge.answer("a1", true);
  assert.equal(await once, "once");
  const chat = bridge.approveFile(req);
  bridge.answer("a2", true, true);
  assert.equal(await chat, "chat");
  const ordinary = bridge.approve(req);
  bridge.answer("a3", true, true);
  assert.equal(await ordinary, true, "a forged remember flag does not make an ordinary request a file grant");
  const declined = bridge.approveFile(req);
  bridge.answer("a4", false, true);
  assert.equal(await declined, false);
});

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
  assert.equal(stepText({ action: "status" }), "Checking computer readiness");
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

test("a point goes to the island as whole numbers with a one-line label", () => {
  const { bridge, events } = setup();
  bridge.point({ x: 100.6, y: 20.2, w: 90.5, h: 24, label: "the settings\nbutton" });
  assert.deepEqual(events, [{ type: "computer.point", x: 101, y: 20, w: 91, h: 24, label: "the settings button" }]);
});

test("a long label is cut for the bubble", () => {
  const { bridge, events } = setup();
  bridge.point({ x: 1, y: 2, w: 3, h: 4, label: "x".repeat(300) });
  const e = events[0] as Extract<IslandEvent, { type: "computer.point" }>;
  assert.ok(e.label.length <= 48);
});

test("with no island attached a point is dropped, and says so", () => {
  const bridge = createComputerBridge();
  assert.equal(bridge.point({ x: 1, y: 2, w: 3, h: 4, label: "a" }), false);
});

test("with an island attached a point reports that it was sent", () => {
  const { bridge } = setup();
  assert.equal(bridge.point({ x: 1, y: 2, w: 3, h: 4, label: "a" }), true);
});

test("pointing shows as a step in the bubble", () => {
  assert.equal(stepText({ action: "point", app: "Brave Browser" }), "Pointing in Brave Browser");
  assert.equal(stepText({ action: "point" }), "Pointing at something");
});

test("a request can ask for its own, longer wait", async () => {
  const { bridge, events } = setup({ timeoutMs: 20 });
  const answer = bridge.approve({ summary: "s", reason: "r", timeoutMs: 400 });
  await new Promise((r) => setTimeout(r, 80)); // past the default wait
  assert.equal(bridge.pending().length, 1);
  bridge.answer((events[0] as { id: string }).id, true);
  assert.equal(await answer, true);
});

test("a reason is cut at 140 characters unless the caller asks for more, and never goes past the hard limit", async () => {
  const { bridge, events } = setup();
  void bridge.approve({ summary: "s", reason: "r".repeat(300) });
  void bridge.approve({ summary: "s", reason: "r".repeat(300), reasonMax: 400 });
  void bridge.approve({ summary: "s", reason: "r".repeat(2000), reasonMax: 5000 });
  const lengths = events.filter((e) => e.type === "approval.request").map((e) => (e as { reason: string }).reason.length);
  assert.deepEqual(lengths, [140, 300, 600]);
  bridge.cancelAll();
});

test("Full access confirmation preserves its entire scope and marks the expanded native card", async () => {
  const { FULL_ACCESS_CONFIRMATION } = await import("./chat-access.ts");
  const { bridge, events } = setup();
  const pending = bridge.approve({ summary: "Enable Full access for this chat?", reason: FULL_ACCESS_CONFIRMATION, reasonMax: 600, accessChange: true });
  const ask = events.find((e) => e.type === "approval.request");
  assert.equal(ask?.type, "approval.request");
  if (ask?.type === "approval.request") { assert.equal(ask.reason, FULL_ACCESS_CONFIRMATION); assert.equal(ask.accessChange, true); bridge.answer(ask.id, false); }
  assert.equal(await pending, false);
});

test("the agent cursor starts once per computer task and finishes when the task ends", async () => {
  const events: string[] = [];
  const bridge = createComputerBridge({ endAfterMs: 10, cursor: { start: async () => { events.push("start"); }, finish: async () => { events.push("finish"); } } });
  bridge.attach(() => {});
  bridge.step({ action: "look", app: "Calculator" });
  bridge.step({ action: "click", app: "Calculator" });
  await new Promise((r) => setTimeout(r, 40));
  bridge.step({ action: "look", app: "Calculator" });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(events, ["start", "finish", "start", "finish"]);
});

test("input is background until the island sets the foreground default", () => {
  const bridge = createComputerBridge();
  assert.equal(bridge.deliveryMode(), "background");
  bridge.setForeground(true);
  assert.equal(bridge.deliveryMode(), "foreground");
  bridge.setForeground(false);
  assert.equal(bridge.deliveryMode(), "background");
});

test("read-only readiness does not initialize the agent cursor before the measured probe", async () => {
  const calls: string[] = [];
  const bridge = createComputerBridge({ endAfterMs: 10, cursor: { start: async () => { calls.push("start"); }, finish: async () => { calls.push("finish"); } } });
  bridge.attach(() => {});
  bridge.step({ action: "status" });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(calls, []);
});
