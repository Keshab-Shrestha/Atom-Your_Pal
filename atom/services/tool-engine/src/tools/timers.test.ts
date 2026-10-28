import { test } from "node:test";
import assert from "node:assert/strict";
import { createTimers, spokenDuration, type TimerInfo } from "./timers.ts";

function harness() {
  let clock = 1_000_000;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let handle = 0;
  const fired: TimerInfo[] = [];
  const timers = createTimers({
    onFire: (t) => fired.push(t),
    now: () => clock,
    setTimeout: (fn, ms) => {
      pending.set(++handle, { at: clock + ms, fn });
      return handle;
    },
    clearTimeout: (h) => pending.delete(h as number),
    max: 3,
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const [h, p] of [...pending]) if (p.at <= clock) (pending.delete(h), p.fn());
  };
  const [set, list, cancel] = timers.tools;
  return { timers, set, list, cancel, fired, advance };
}

test("spoken durations", () => {
  assert.equal(spokenDuration(600), "10 minutes");
  assert.equal(spokenDuration(90), "1 minute and 30 seconds");
  assert.equal(spokenDuration(3725), "1 hour and 2 minutes");
  assert.equal(spokenDuration(1), "1 second");
});

test("a timer fires once, at its time, and leaves the list", async () => {
  const h = harness();
  assert.equal(await h.set.run({ seconds: 600, label: " pasta " }), "Timer #1 for pasta set for 10 minutes.");
  await h.set.run({ seconds: 60 });
  assert.match(String(await h.list.run({})), /^#2 \(1 minute left\)\n#1 "pasta" \(10 minutes left\)$/);
  h.advance(60_000);
  assert.deepEqual(h.fired.map((t) => t.id), [2]);
  h.advance(540_000);
  assert.deepEqual(h.fired.map((t) => t.label), ["", "pasta"]);
  assert.equal(await h.list.run({}), "No timers running.");
});

test("cancel one or all; limits on length and count", async () => {
  const h = harness();
  await h.set.run({ seconds: 10 });
  await h.set.run({ seconds: 20 });
  await h.set.run({ seconds: 30 });
  await assert.rejects(Promise.resolve().then(() => h.set.run({ seconds: 40 })), /already 3 timers/);
  assert.equal(await h.cancel.run({ id: 2 }), "Cancelled timer #2.");
  assert.equal(await h.cancel.run({ id: 2 }), "There is no running timer #2.");
  assert.equal(await h.cancel.run({ all: true }), "Cancelled 2 timers.");
  h.advance(60_000);
  assert.equal(h.fired.length, 0);
  await assert.rejects(Promise.resolve().then(() => h.set.run({ seconds: 0 })), /between 1 and 86400/);
  await assert.rejects(Promise.resolve().then(() => h.set.run({ seconds: 90_000 })), /between 1 and 86400/);
});
