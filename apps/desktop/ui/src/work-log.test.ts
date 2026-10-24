import assert from "node:assert/strict";
import { test } from "node:test";
import { callCount, callWord, duration, elapsedMs, interrupt, isWorking, settledAnswer, validWork, workLabel, type WorkLog } from "./work-log.ts";

const U = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const snapshot = (extra: object = {}) => ({ type: "chat.work" as const, chat: "c1", turn: U(1), startedAt: "2026-10-24T00:00:00Z", elapsedMs: 1200, state: "working" as const, calls: [{ id: U(2), tool: "Read", state: "started" as const }, { id: U(3), tool: "Grep", state: "ok" as const, ms: 40 }], omitted: 0, questions: [], ...extra });
const log = (extra: object = {}): WorkLog => ({ work: snapshot(extra), n: 1 });

test("a snapshot within the runtime's limits is accepted, and one beyond them is not", () => {
  assert.ok(validWork(snapshot()));
  assert.ok(!validWork(snapshot({ turn: "nope" })));
  assert.ok(!validWork(snapshot({ chat: "" })) && !validWork(snapshot({ chat: "x".repeat(101) })));
  assert.ok(!validWork(snapshot({ elapsedMs: -1 })) && !validWork(snapshot({ elapsedMs: 86_400_001 })) && !validWork(snapshot({ elapsedMs: Number.NaN })));
  assert.ok(!validWork(snapshot({ state: "interrupted" })));
  assert.ok(!validWork(snapshot({ omitted: -1 })) && !validWork(snapshot({ omitted: 1.5 })));
  assert.ok(!validWork(snapshot({ calls: Array.from({ length: 61 }, (_, n) => ({ id: U(10 + n), tool: "Read", state: "ok" })) })));
  assert.ok(!validWork(snapshot({ calls: [{ id: U(2), tool: "x".repeat(101), state: "ok" }] })));
  assert.ok(!validWork(snapshot({ calls: [{ id: U(2), tool: "Read", state: "weird" }] })));
  assert.ok(!validWork(snapshot({ calls: [{ id: U(2), tool: "Read", state: "ok", ms: 90_000_000 }] })));
  const q = { id: U(4), prompt: "Which?", choices: ["a", "b"], state: "pending" };
  assert.ok(validWork(snapshot({ questions: [q] })));
  assert.ok(!validWork(snapshot({ questions: [{ ...q, prompt: "x".repeat(601) }] })));
  assert.ok(!validWork(snapshot({ questions: [{ ...q, choices: ["1", "2", "3", "4", "5"] }] })));
  assert.ok(!validWork(snapshot({ questions: [q, q, q, q, q] })));
});

test("time runs only while the work does, and never past a day", () => {
  assert.equal(elapsedMs(log(), 3000), 4200);
  assert.equal(elapsedMs(log({ state: "completed" }), 3000), 1200);
  assert.equal(elapsedMs(log({ elapsedMs: 86_399_000 }), 5000), 86_400_000);
  assert.equal(elapsedMs(log(), -50), 1200, "a clock that went backwards adds nothing");
});

test("losing the runtime freezes time, makes unfinished calls unknown and skips a waiting question", () => {
  const waiting = log({ questions: [{ id: U(4), prompt: "Which?", choices: [], state: "pending" }] });
  const cut = interrupt(waiting);
  assert.ok(isWorking(waiting) && !isWorking(cut));
  assert.deepEqual(cut.work.calls.map((c) => c.state), ["unknown", "ok"]);
  assert.equal(cut.work.questions[0]!.state, "skipped");
  assert.equal(elapsedMs(cut, 9000), 1200);
  assert.equal(interrupt(cut), cut, "once is enough");
  const done = log({ state: "completed" });
  assert.equal(interrupt(done), done, "finished work is left as it was");
});

test("the label says how it went and for how long", () => {
  assert.equal(workLabel(log(), 2000), "Working for 3s");
  assert.equal(workLabel(log({ state: "completed", elapsedMs: 65_000 }), 0), "Worked for 1m 5s");
  assert.equal(workLabel(log({ state: "failed" }), 0), "Failed after 1s");
  assert.equal(workLabel(log({ state: "stopped" }), 0), "Stopped after 1s");
  assert.equal(workLabel(interrupt(log()), 0), "Interrupted after 1s");
  assert.equal(duration(59_999), "59s");
  assert.equal(duration(3_600_000), "60m 0s");
});

test("words for calls and questions do not claim more than was seen", () => {
  assert.deepEqual((["started", "ok", "error", "unknown"] as const).map(callWord), ["Running", "Finished", "Reported error", "Outcome unknown"]);
  assert.equal(callCount(1), "1 observed call");
  assert.equal(callCount(0), "0 observed calls");
  assert.equal(settledAnswer({ id: U(1), prompt: "p", choices: [], state: "answered", answer: "Yes" }), "Yes");
  assert.match(settledAnswer({ id: U(1), prompt: "p", choices: [], state: "expired" }), /expired/);
  assert.match(settledAnswer({ id: U(1), prompt: "p", choices: [], state: "skipped" }), /skipped or interrupted/);
});
