import { test } from "node:test";
import assert from "node:assert/strict";
import type { Routine } from "@atom/helpers";
import { routeWake, routineChat, routineStarter, type WakeTargets } from "./native-entry.ts";

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
  assert.deepEqual(failed.logged, [["routine.turn", { routine: 3, ok: false }]]);
});
