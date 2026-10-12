import { test } from "node:test";
import assert from "node:assert/strict";
import { HelperError, MAX_COMMENT_CHARS } from "@atom/helpers";
import { taskSteering } from "./task-steering.ts";

// ADR-098 item 3: steer and interrupt, against a fake store and a fake live run.

const log = { debug() {}, info() {}, warn() {}, error() {} } as any;

function setup(state = "running") {
  const comments: [number, string, string | undefined][] = [];
  const unread: [number, number][] = [];
  const store: any = {
    get: (id: number) => (id === 1 ? { id, helper: "h", state } : undefined),
    addComment: (id: number, text: string, mode?: string) => comments.push([id, text, mode]),
    steerUnread: (id: number, n: number) => unread.push([id, n]),
  };
  return { steering: taskSteering(store, log), comments, unread };
}
const run = (steer: (t: string) => boolean, interrupt: () => Promise<boolean> = async () => true) => ({ steer, interrupt }) as any;

test("steer: a live run that takes the message gets it now", () => {
  const { steering, comments } = setup();
  const got: string[] = [];
  steering.track(1).attach(run((t) => (got.push(t), true)));
  assert.equal(steering.steer(1, "  go left  "), "live");
  assert.deepEqual(got, ["go left"]);
  assert.deepEqual(comments, [[1, "go left", "live"]]);
});

test("steer: a run that refuses, or no run, keeps it as a note that wakes the task after", () => {
  const a = setup();
  a.steering.track(1).attach(run(() => false));
  assert.equal(a.steering.steer(1, "x"), "queued");
  assert.deepEqual(a.comments, [[1, "x", "after"]]);
  const b = setup();
  assert.equal(b.steering.steer(1, "x"), "queued");
  assert.deepEqual(b.comments, [[1, "x", "after"]]);
});

test("steer: a task that is not running keeps a plain note", () => {
  const { steering, comments } = setup("done");
  steering.track(1).attach(run(() => true));
  assert.equal(steering.steer(1, "again"), "queued");
  assert.deepEqual(comments, [[1, "again", undefined]]);
});

test("steer: empty, too long and unknown tasks throw HelperError and write nothing", () => {
  const { steering, comments } = setup();
  assert.throws(() => steering.steer(1, "   "), HelperError);
  assert.throws(() => steering.steer(1, "x".repeat(MAX_COMMENT_CHARS + 1)), /too long/);
  assert.throws(() => steering.steer(2, "hi"), /gone/);
  assert.equal(steering.steer(1, "x".repeat(MAX_COMMENT_CHARS)), "queued");
  assert.equal(comments.length, 1);
});

test("detach forgets the run and reports unread steering only when there is some", () => {
  const { steering, unread, comments } = setup();
  const t = steering.track(1);
  t.attach(run(() => true));
  t.detach(0);
  t.attach(run(() => true));
  t.detach(2);
  assert.deepEqual(unread, [[1, 2]]);
  assert.equal(steering.steer(1, "late"), "queued", "no run attached any more");
  assert.deepEqual(comments, [[1, "late", "after"]]);
});

test("interrupt: only a running task with a run that accepts", async () => {
  const a = setup();
  a.steering.track(1).attach(run(() => true, async () => true));
  await a.steering.interrupt(1);
  await assert.rejects(a.steering.interrupt(2), /gone/);
  const b = setup("done");
  await assert.rejects(b.steering.interrupt(1), /Only a running task/);
  const c = setup();
  await assert.rejects(c.steering.interrupt(1), /cannot be interrupted/);
  const d = setup();
  d.steering.track(1).attach(run(() => true, async () => false));
  await assert.rejects(d.steering.interrupt(1), HelperError);
});
