import { test } from "node:test";
import assert from "node:assert/strict";
import { createCore, type Core } from "@atom/core";
import { openHelperStore, watchGoals, type HelperStore } from "@atom/helpers";
import { openMemoryStore } from "@atom/memory";
import type { Message } from "@atom/contracts";
import { POST_CHARS, goalPostText, startGoalPosts } from "./goal-post.ts";
import { MAX_PROJECT_MESSAGES, createProjects } from "./projects-wiring.ts";

// ADR-109: a goal's result comes back into the chat that asked.

const turn = (i: number): Message[] => [{ role: "user", content: `u${i}` }, { role: "assistant", content: `a${i}` }];
const report = (body = "Photos is 12 GB.") => ({ title: "Storage check", summary: "Photos use most space.", body, sources: [] });

function setup(chatId = "chat-1", saved: Message[] = turn(1)) {
  const helpers = openHelperStore({ path: ":memory:" });
  const memory = openMemoryStore({ path: ":memory:" });
  if (saved.length) memory.chats.save(chatId, saved);
  const model = { complete: async () => ({ text: "ok" }) };
  const log: string[] = [];
  const state = { current: chatId as string | undefined, busy: false, resumed: [] as string[], posted: [] as string[] };
  const start = () =>
    startGoalPosts({
      helpers,
      chats: memory.chats,
      currentChat: () => state.current,
      resume: (id) => {
        if (state.busy) throw new Error("busy");
        state.resumed.push(id);
      },
      posted: (id) => state.posted.push(id),
      log: { info: (e, f) => log.push(`${e} ${JSON.stringify(f ?? {})}`), warn: (e) => log.push(e) },
      retryMs: 5,
    });
  return { helpers, memory, model, log, state, start };
}
const finish = (helpers: HelperStore, source: string | undefined, rep = report()) => {
  const goal = helpers.addGoal("check storage", [{ helper: "kame", task: "Check the folder" }], source);
  helpers.start(goal.tasks[0]!.id);
  helpers.finish(goal.tasks[0]!.id, rep);
  helpers.endGoal(goal.id, rep);
  return goal;
};
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test("a finished goal posts one assistant turn into its chat, once, even when the event repeats", () => {
  const t = setup();
  const stop = t.start();
  const goal = finish(t.helpers, "chat-1");
  const got = t.memory.chats.messages("chat-1");
  assert.equal(got.length, 3);
  assert.equal(got[2]!.role, "assistant");
  assert.match(got[2]!.content, /^Kame finished: Storage check\n\nPhotos use most space\.\n\nPhotos is 12 GB\.$/);
  assert.deepEqual(t.state.posted, ["chat-1"]);
  assert.deepEqual(t.state.resumed, ["chat-1"], "the open chat's Core gets the turn too");
  assert.equal(t.helpers.goal(goal.id)!.chatPostedAt instanceof Date, true);
  // a repeated change event and a restart post nothing more
  stop();
  t.start()();
  assert.equal(t.memory.chats.messages("chat-1").length, 3);
  assert.deepEqual(t.log.filter((l) => l.startsWith("goal.posted")), ['goal.posted {"goal":1,"posted":true}']);
});

test("sources without a window chat are skipped: none, telegram, api, api-*", () => {
  const t = setup();
  t.start();
  for (const source of [undefined, "telegram", "api", "api-abc"]) finish(t.helpers, source);
  assert.equal(t.memory.chats.messages("chat-1").length, 2);
  assert.equal(t.memory.chats.messages("telegram").length, 0);
  assert.deepEqual(t.state.posted, []);
});

test("a failed goal says who, why and how to retry", async () => {
  const t = setup();
  t.start();
  watchGoals({ store: t.helpers, write: async () => "", onEnded: () => {} });
  const goal = t.helpers.addGoal("check storage", [{ helper: "kame", task: "Check the folder" }], "chat-1");
  t.helpers.start(goal.tasks[0]!.id);
  t.helpers.fail(goal.tasks[0]!.id, "The folder is not readable.");
  await wait(5);
  const text = t.memory.chats.messages("chat-1").at(-1)!.content;
  assert.match(text, /^Kame could not finish: check storage\n\nKame: The folder is not readable\.\n\nTo try again, press Retry in Needs you, or open Board > Kame > #1\.$/);
});

test("a long report is cut with a pointer to the Board", () => {
  const text = goalPostText(
    { id: 1, text: "g", createdAt: new Date(), endedAt: new Date(), tasks: [{ id: 7, helper: "kame", state: "done" } as never], report: report("x".repeat(3000)) },
    { soul: () => ({ name: "Kame" }) as never, report: () => undefined },
  )!;
  assert.match(text, /…\n\nFull report: Board > Kame > #7$/);
  assert.ok(text.length < POST_CHARS + 200);
});

test("a deleted chat gets nothing, and the goal is marked so it is not tried again", () => {
  const t = setup("gone-chat", []);
  t.state.current = "other";
  t.start();
  const goal = finish(t.helpers, "gone-chat");
  assert.equal(t.memory.chats.messages("gone-chat").length, 0);
  assert.equal(t.helpers.goal(goal.id)!.chatPostedAt instanceof Date, true);
});

test("a goal that ended while ATOM was closed posts at the next start, once", () => {
  const t = setup();
  const goal = finish(t.helpers, "chat-1"); // no poster running
  assert.equal(t.memory.chats.messages("chat-1").length, 2);
  const stop = t.start();
  assert.equal(t.memory.chats.messages("chat-1").length, 3);
  stop();
  t.start();
  assert.equal(t.memory.chats.messages("chat-1").length, 3);
  assert.equal(t.helpers.goalsToPost().length, 0, String(goal.id));
});

test("while the Core answers in that chat the post waits, and is not lost", async () => {
  const t = setup();
  t.state.busy = true;
  const stop = t.start();
  finish(t.helpers, "chat-1");
  assert.equal(t.memory.chats.messages("chat-1").length, 2, "nothing written under a busy Core");
  t.state.busy = false;
  await wait();
  assert.equal(t.memory.chats.messages("chat-1").length, 3);
  assert.equal(t.state.posted.length, 1);
  stop();
});

test("a chat that is not saved yet, but is the current one, waits for its first save", async () => {
  const t = setup("chat-1", []);
  const stop = t.start();
  finish(t.helpers, "chat-1");
  t.memory.chats.save("chat-1", turn(1));
  await wait();
  assert.equal(t.memory.chats.messages("chat-1").length, 3);
  stop();
});

test("a project chat keeps the posted turn through the 2000-turn cap and a later reply", async () => {
  const t = setup("c1", []);
  const projects = createProjects({ memory: t.memory, helpers: t.helpers, log: { info() {}, warn() {} }, checkModel: () => ({ error: "no" }) });
  t.memory.projects.add({ name: "Lyricists", folder: process.cwd() });
  t.memory.chats.save("c1", Array.from({ length: MAX_PROJECT_MESSAGES / 2 }, (_, i) => turn(i)).flat());
  t.memory.chats.setProject("c1", t.memory.projects.list()[0]!.id);
  // a real window Core for the chat, saving as the runtime does
  const core: Core = createCore({
    model: t.model,
    onExchange: (id, turns) => t.memory.chats.save(id, projects.fullTurns(id, turns)),
  });
  core.resume("c1", t.memory.chats.messages("c1"));
  const stop = startGoalPosts({
    helpers: t.helpers,
    chats: t.memory.chats,
    currentChat: () => core.sessionId,
    resume: (id, turns) => core.resume(id, turns),
    posted: () => {},
    log: { info() {}, warn() {} },
  });
  finish(t.helpers, "c1");
  let stored = t.memory.chats.messages("c1");
  assert.equal(stored.length, MAX_PROJECT_MESSAGES - 1, "capped at 2000; a chat never starts with an answer");
  assert.match(stored.at(-1)!.content, /^Kame finished/);
  await core.handle({ text: "thanks", source: "text" });
  stored = t.memory.chats.messages("c1");
  assert.ok(stored.length >= MAX_PROJECT_MESSAGES - 1 && stored.length <= MAX_PROJECT_MESSAGES);
  assert.deepEqual(stored.slice(-3).map((m) => m.content.slice(0, 11)), ["Kame finish", "thanks", "ok"]);
  assert.equal(stored.filter((m) => m.content.startsWith("Kame finished")).length, 1, "no duplicate");
  stop();
});

test("a plain chat keeps the posted turn after the Core's next exchange", async () => {
  const t = setup("c1", turn(1));
  const core: Core = createCore({ model: t.model, onExchange: (id, turns) => t.memory.chats.save(id, turns) });
  core.resume("c1", t.memory.chats.messages("c1"));
  const stop = startGoalPosts({ helpers: t.helpers, chats: t.memory.chats, currentChat: () => core.sessionId, resume: (id, turns) => core.resume(id, turns), posted: () => {}, log: { info() {}, warn() {} } });
  finish(t.helpers, "c1");
  await core.handle({ text: "thanks", source: "text" });
  assert.deepEqual(t.memory.chats.messages("c1").map((m) => m.content.slice(0, 5)), ["u1", "a1", "Kame ", "thank", "ok"]);
  stop();
});
