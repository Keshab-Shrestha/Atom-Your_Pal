import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { enableApi, startRuntime, until, type SmokeRuntime } from "./smoke-harness.ts";

// Live smoke test: a real runtime, a real Claude session (the signed-in plan, Haiku for the chat) and a real agent. It checks the flows that mocks cannot:
// a chat answer, a phone chat that the window can open and write, an agent that saves a file with no folder granted, an edit that asks for approval,
// and a delete that is refused. Run it with `pnpm test:live` (it uses a little of the plan, about two minutes). It writes only inside one folder in
// ~/Documents and removes it at the end. 2026-10-16: the bug that no folders agent could use Write in a normal chat passed ~970 unit tests; this is the test
// that would have caught it.

const live = process.env.ATOM_LIVE_TESTS === "1";
const SKIP = live ? false : "set ATOM_LIVE_TESTS=1 (pnpm test:live) to run the live smoke test";
const GOAL_MS = 240_000;

async function giveGoal(runtime: SmokeRuntime, goal: string): Promise<number> {
  const made = await runtime.api("POST", "/v1/goals", { body: { goal } });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const id = made.json.data.goalId as number | null;
  assert.ok(id, `no task was made for the goal. ATOM said: ${String(made.json.data.answer).slice(0, 300)}`);
  return id;
}

const goalEnded = (runtime: SmokeRuntime, id: number) =>
  until(
    async () => (await runtime.api("GET", `/v1/goals/${id}`)).json?.data,
    (goal) => goal?.status === "ended",
    GOAL_MS,
    `goal ${id} to end`,
  );

test("live: chat, shared phone chat, an agent saves a file with no folder granted, an edit asks, a delete is refused", { skip: SKIP, timeout: 900_000 }, async () => {
  const runtime = await startRuntime({ readyMs: 90_000 });
  const folder = join(homedir(), "Documents", `atom-smoke-${randomBytes(4).toString("hex")}`);
  const file = join(folder, "hello.txt");
  try {
    mkdirSync(folder, { recursive: true });
    await enableApi(runtime);

    // 1. A chat turn through the Local API (the phone page's route) reaches the model and comes back.
    const chat = await runtime.api("POST", "/v1/chat", { body: { text: "Reply with exactly the word PONG and nothing else.", chatId: "smoke" } });
    assert.equal(chat.status, 200, JSON.stringify(chat.json));
    assert.match(String(chat.json.data.answer), /PONG/i);

    // 2. The phone chat shows in the window's list, is not read-only, and the window can open it.
    runtime.send({ type: "chats.list" });
    const chats = await runtime.waitFor((e) => e.type === "chats" && Array.isArray(e.chats) && e.chats.some((c: any) => c.id === "api-smoke"), 15_000, "the phone chat in the chats list");
    assert.ok(!chats.chats.find((c: any) => c.id === "api-smoke").readOnly, "a phone chat is shared, not read-only");
    runtime.send({ type: "chat.open", id: "api-smoke" });
    await runtime.waitFor((e) => e.type === "chat.opened" && e.id === "api-smoke", 15_000, "the window opening the phone chat");

    // 3. An agent with no folder granted saves a new file anywhere the file rules allow (it could not before: the session had no Write tool for it).
    const created = await giveGoal(runtime, `Kame, create the file ${file} with exactly this text: hello smoke. Do nothing else.`);
    const first = await goalEnded(runtime, created);
    assert.ok(existsSync(file), `Kame did not save the file. Report: ${JSON.stringify(first.summary ?? first.tasks).slice(0, 400)}`);
    assert.match(readFileSync(file, "utf8"), /hello smoke/);

    // 4. Changing a file that exists asks on the Mac; the answer comes over the island protocol, as the app sends it.
    const edited = await giveGoal(runtime, `Kame, in the file ${file} replace the word smoke with the word again. Do nothing else.`);
    const card = await runtime.waitFor((e) => e.type === "approval.request", 180_000, "the approval card for changing an existing file");
    assert.match(String(card.summary) + String(card.reason), /change|edit|file/i);
    runtime.send({ type: "approval.answer", id: card.id, approved: true });
    await goalEnded(runtime, edited);
    assert.match(readFileSync(file, "utf8"), /hello again/, "the approved edit was made");

    // 5. A delete is refused in code: the file is still there after the agent tried.
    const removed = await giveGoal(runtime, `Kame, delete the file ${file}. Do nothing else.`);
    await goalEnded(runtime, removed);
    assert.ok(existsSync(file), "an agent must never delete a file");
  } finally {
    try {
      rmSync(folder, { recursive: true, force: true });
    } finally {
      await runtime.stop();
    }
  }
});
