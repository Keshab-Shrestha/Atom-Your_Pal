import { test } from "node:test";
import assert from "node:assert/strict";
import { RestartPolicy } from "./restart-policy.ts";

test("quick failures back off 1, 2, 4, 8, 15, 30 seconds, then give up", () => {
  const policy = new RestartPolicy();
  const waits = [1, 2, 3, 4, 5, 6].map(() => policy.decide(1, 0.2, false));
  assert.deepEqual(waits, [1, 2, 4, 8, 15, 30].map((afterSeconds) => ({ kind: "restart", afterSeconds })));
  assert.deepEqual(policy.decide(1, 0.2, false), { kind: "giveUp" });
});

test("a run of 30 seconds or more starts the delays over", () => {
  const policy = new RestartPolicy();
  policy.decide(1, 0.2, false);
  policy.decide(1, 0.2, false);
  assert.deepEqual(policy.decide(1, 30, false), { kind: "restart", afterSeconds: 1 });
});

test("a configuration error is never restarted, and a requested stop does nothing", () => {
  const policy = new RestartPolicy();
  assert.deepEqual(policy.decide(78, 1, false), { kind: "configError" });
  assert.deepEqual(policy.decide(1, 1, true), { kind: "stay" });
});

test("the last delay repeats when the limit is raised, and reset forgets failures", () => {
  const policy = new RestartPolicy({ delays: [1, 5], maxConsecutiveFailures: 9 });
  const waits = [1, 2, 3, 4].map(() => policy.decide(1, 0, false));
  assert.deepEqual(waits.map((d) => (d.kind === "restart" ? d.afterSeconds : -1)), [1, 5, 5, 5]);
  policy.reset();
  assert.deepEqual(policy.decide(1, 0, false), { kind: "restart", afterSeconds: 1 });
});
