import { test } from "node:test";
import assert from "node:assert/strict";
import type { Routine } from "@atom/helpers";
import { nativeSteering, routeWake, routineChat, routineStarter, taskStarter, type WakeTargets } from "./native-entry.ts";

// ADR-110 (Phase N3): where a reply the native session gave by itself goes, and routines as main-agent turns. Fakes only.

function targets(voice: string, routines: Record<number, boolean> = {}) {
  const spoken: string[] = [];
  const telegram: [string, boolean][] = [];
  const to: WakeTargets = {
    voiceChat: () => voice,
    speak: (t) => void spoken.push(t),
    telegram: (t, pushed) => void telegram.push([t, pushed]),
    routine: (id) => (id in routines ? { notifyTelegram: routines[id]! } : undefined),
  };
  return { to, spoken, telegram };
}

test("a later reply in the voice chat is spoken (the island's report line); in another chat it is not", () => {
  const t = targets("chat-1");
  routeWake("chat-1", "Sid found three flights.", t.to);
  routeWake("chat-2", "Penny wrote the draft.", t.to);
  assert.deepEqual(t.spoken, ["Sid found three flights."]);
  assert.deepEqual(t.telegram, []);
});

test("a later reply in the telegram chat is sent to Telegram as a reply, never spoken, even when the window shows that chat", () => {
  const t = targets("telegram");
  routeWake("telegram", "Sid found three flights.", t.to);
  assert.deepEqual(t.telegram, [["Sid found three flights.", false]]);
  assert.deepEqual(t.spoken, []);
});

test("an API chat is not spoken; a routine's later reply goes to Telegram only when its flag is on", () => {
  const t = targets("api-goal-7", { 3: true, 4: false });
  routeWake("api-goal-7", "Done.", t.to);
  routeWake(routineChat(3), "News: calm.", t.to);
  routeWake(routineChat(4), "Weather: rain.", t.to);
  assert.deepEqual(t.spoken, []);
  assert.deepEqual(t.telegram, [["News: calm.", true]]);
});

const routine = (over: Partial<Routine> = {}): Routine =>
  ({ id: 3, helper: "sid", task: "summarise networking news", schedule: { kind: "daily", minute: 480 }, createdAt: new Date(0), lastSkipped: false, paused: false, notifyTelegram: true, webhook: false, ...over }) as Routine;

test("task activity covers the whole queue, including failure and a removed retry", async () => {
  const activity: boolean[] = [];
  let release!: () => void; const first = new Promise<void>((r) => { release = r; });
  let calls = 0;
  const start = taskStarter({ core: { resume() {}, async handle() { calls++; await first; throw new Error("Unavailable"); } } as never,
    name: () => "Kame", log: { info() {}, warn() {} }, activity: (busy) => activity.push(busy), retryPending: () => false });
  start("kame", "Cedar"); start("kame", "Removed retry", { id: 2, retryOf: 1 });
  assert.deepEqual(activity, [true]);
  release(); await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1); assert.deepEqual(activity, [true, false]);
});

function starter(opts: { busy?: Set<string>; reply?: string; fail?: boolean } = {}) {
  const turns: { chat: string; text: string }[] = [];
  const pushed: [string, boolean][] = [];
  const logged: unknown[] = [];
  let chat = "";
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const start = routineStarter({
    core: {
      resume: (id) => void (chat = id),
      handle: async (input) => {
        turns.push({ chat, text: input.text });
        await gate;
        if (opts.fail) throw new Error("down");
        return { requestId: "r", text: opts.reply ?? "News: calm." };
      },
    },
    messages: () => [],
    busy: (id) => opts.busy?.has(id) ?? false,
    name: (helper) => (helper === "sid" ? "Sid" : undefined),
    telegram: (t, p) => void pushed.push([t, p]),
    log: { info: (e, f) => void logged.push([e, f]), warn: (e, f) => void logged.push([e, f]) },
  });
  return { start, turns, pushed, logged, release };
}

test("a due routine is one main-agent turn in its own chat, handed to its worker by name; Send to Telegram pushes the reply", async () => {
  const s = starter();
  assert.equal(s.start(routine()), true);
  assert.equal(s.start(routine()), false, "its last turn still runs: skipped this time");
  s.release();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(s.turns, [{ chat: "routine-3", text: "Sid, summarise networking news" }]);
  assert.deepEqual(s.pushed, [["News: calm.", true]]);
  assert.equal(s.start(routine()), true, "after the turn it may run again");
  assert.ok(!JSON.stringify(s.logged).includes("news"), "logs ids only");
});

test("a routine whose agent still runs is skipped; a reply while an agent works waits for the agent's result; a failure is logged", async () => {
  assert.equal(starter({ busy: new Set(["routine-3"]) }).start(routine()), false);
  const working = new Set<string>();
  const handed = starter({ busy: working, reply: "I handed it to Sid." });
  assert.equal(handed.start(routine()), true);
  working.add("routine-3"); // the turn started an agent
  handed.release();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(handed.pushed, [], "the agent's result goes later (routeWake), not this reply");
  const quiet = starter();
  quiet.start(routine({ notifyTelegram: false }));
  quiet.release();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(quiet.pushed, [], "flag off: nothing to Telegram");
  const failed = starter({ fail: true });
  failed.start(routine());
  failed.release();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(failed.pushed, []);
  assert.deepEqual(failed.logged, [["routine.turn", { routine: 3, ok: false, message: "down" }]]);
});

test("a task from the window is one main-agent turn in a chat of its own, handed to the worker by name", async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const start = taskStarter({
    core: { resume: (chat: string) => void calls.push(`resume:${chat}`), handle: async (input: { text: string }) => void calls.push(`handle:${input.text}`) } as never,
    name: (helper) => (helper === "sid" ? "Sid" : undefined),
    log: { info: (e) => void logs.push(e), warn: (e) => void logs.push(e) },
    now: () => 100,
  });
  start("sid", "  find three kits  ");
  start("sid", "second");
  assert.throws(() => start("sid", "  "), /task is empty/);
  assert.throws(() => start("nobody", "x"), /no worker called "nobody"/);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ["resume:task-100", "handle:Sid, find three kits", "resume:task-101", "handle:Sid, second"], "one at a time, chat ids never repeat");
  assert.deepEqual(logs, ["task.turn", "task.turn"]);
});

test("a failing task turn is logged and the next task still runs", async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  let n = 0;
  const start = taskStarter({
    core: { resume: () => {}, handle: async () => { if (n++ === 0) throw new Error("boom"); calls.push("ok"); } } as never,
    name: () => "Sid",
    log: { info: (e) => void logs.push(`info:${e}`), warn: (e) => void logs.push(`warn:${e}`) },
  });
  start("sid", "a");
  start("sid", "b");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual([calls, logs], [["ok"], ["warn:task.turn", "info:task.turn"]]);
});

test("steering: a note goes to the chat that runs the task; an empty note or a task nobody runs, is refused", async () => {
  const taken: string[] = [];
  const steering = nativeSteering(() => [{ steer: () => false }, { steer: (job, text) => (job === 5 ? (taken.push(text), true) : false) }]);
  assert.equal(steering.steer(5, "  use the cheaper kit "), "live");
  assert.deepEqual(taken, ["use the cheaper kit"]);
  assert.throws(() => steering.steer(5, "   "), /message is empty/);
  assert.equal(steering.steer(5, "x".repeat(8000)), "live");
  assert.equal(taken.at(-1)?.length, 8000);
  assert.throws(() => steering.steer(6, "hi"), /does not run in an open chat/);
  await assert.rejects(steering.interrupt(5), /stop it instead/);
});

// 2026-10-16 (code review): a failed task or routine turn logged ok:false with no reason and told Keshab nothing; "Run task" just did nothing.
test("a failing task turn says why, in the log and in a line for Keshab", async () => {
  const lines: string[] = [];
  const logs: [string, Record<string, unknown>][] = [];
  const start = taskStarter({
    core: { resume: () => {}, handle: async () => { throw new Error("No Claude model is signed in"); } } as never,
    name: () => "Sid",
    failed: (line) => void lines.push(line),
    log: { info: () => {}, warn: (e, f) => void logs.push([e, f]) },
  });
  start("sid", "find kits");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(lines, ["Sid's task did not run: No Claude model is signed in"]);
  assert.deepEqual(logs, [["task.turn", { helper: "sid", ok: false, message: "No Claude model is signed in" }]]);
  assert.ok(!JSON.stringify(logs).includes("find kits"), "the task's own words never reach the log");
});

test("a failing routine turn says why too, and a failure without a message still gets a line", async () => {
  const lines: string[] = [];
  const s = routineStarter({
    core: { resume: () => {}, handle: async () => { throw "plain string, not an Error"; } } as never,
    messages: () => [],
    busy: () => false,
    name: () => "Sid",
    failed: (line) => void lines.push(line),
    log: { info: () => {}, warn: () => {} },
  });
  s({ id: 9, helper: "sid", task: "news", notifyTelegram: false } as unknown as Routine);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(lines, ["A routine did not run: unknown reason"]);
});

// 2026-10-16 (test audit): the Telegram /interrupt test used a fake steering whose interrupt succeeds; the real one always refuses. Nothing said so.
test("native steering refuses to interrupt a running task and says to stop it instead", async () => {
  await assert.rejects(nativeSteering(() => []).interrupt(5), /stop it instead/);
});
