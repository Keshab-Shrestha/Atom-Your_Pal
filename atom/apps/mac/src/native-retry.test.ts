import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openHelperStore } from "@atom/helpers";
import { createGateway, createCodexSessionAdapter } from "@atom/llm-gateway";
import { createNativeCore } from "./native-core.ts";
import { createCodexToolRouter } from "./codex-tools.ts";
import { nativeRetryStarter, retrySourceChat, taskStarter } from "./native-entry.ts";
import { fakeCodex } from "../../../tests/codex-harness.ts";

const log = { info() {}, warn() {} };
test("a recovered file task retried twice dispatches one checked worker and preserves both attempt records", { timeout: 10_000 }, async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-native-retry-")));
  const path = join(home, "helpers.db"), file = join(home, "draft.txt");
  writeFileSync(file, "partial draft from previous attempt");
  let initial = openHelperStore({ path, home });
  const source = initial.addNativeJob("kame", "Finish the fictional draft", { chatId: "original" });
  initial.step(source.id, "Saved partial draft"); initial.close();
  let retry!: (id: number) => void;
  const store = openHelperStore({ path, home, retryNative: (id) => retry(id) });
  let writes = 0, approvals = 0;
  const worker = fakeCodex(async ({ text, call }) => {
    assert.match(text, /Finish the fictional draft/);
    assert.match(text, /Inspect the actual files/);
    assert.doesNotMatch(text, /MODEL-REPLACED-TASK/);
    const read = await call("atom_Read", { file_path: file }); assert.equal(read.success, true, JSON.stringify(read));
    const write = await call("atom_Write", { file_path: file, content: `finished once ${++writes}` }); assert.equal(write.success, true, JSON.stringify(write));
    return "Saved the finished draft.";
  });
  const main = fakeCodex(async ({ call }) => {
    const response = await call("atom_delegate", { subagent_type: "kame", description: "Retry", prompt: "MODEL-REPLACED-TASK" });
    assert.equal(response.success, true, JSON.stringify(response));
    return "The worker saved the finished draft.";
  });
  const tools = { specs: () => [], run: async (c: { id: string }) => ({ callId: c.id, content: "unavailable", isError: true }) };
  const team = { helpers: store, worktrees: join(home, "worktrees"), approve: async () => { approvals++; return true; } };
  const router = createCodexToolRouter({ program: "fake", model: "codex-default", tools, team, home, session: { transport: worker.factory } });
  const model = createGateway({ provider: createCodexSessionAdapter({ program: "fake", model: "codex-default", transport: main.factory, runner: (r) => router.forRequest(r) }), timeoutMs: 5000, maxRetries: 0 });
  const core = createNativeCore({ claudePath: "", tools, team, modelFor: () => undefined, toolModel: () => model });
  let settled!: () => void; const complete = new Promise<void>((r) => { settled = r; });
  const start = taskStarter({ core, name: () => "Kame", log, retrySettled: (id, reason) => { store.failQueuedRetry(id, reason ?? "No worker started"); settled(); } });
  retry = nativeRetryStarter({ store, start });
  try {
    assert.equal(store.get(source.id)!.recoveryNeeded, true);
    store.retry(source.id); store.retry(source.id); store.retry(source.id);
    await complete;
    const next = store.get(source.id)!.retriedAs!;
    assert.equal(store.get(next)!.state, "done", JSON.stringify({job:store.get(next),report:store.report(next)}));
    assert.equal(store.get(next)!.retryOf, source.id);
    assert.equal(store.get(source.id)!.state, "failed");
    assert.equal(store.get(source.id)!.step, "Saved partial draft");
    store.retry(source.id);
    assert.equal(writes, 1); assert.equal(approvals, 1);
    assert.equal(main.wires.length, 1); assert.equal(worker.wires.length, 1);
    assert.equal(readFileSync(file, "utf8"), "finished once 1");
    const denied = await router.forRequest({ system: "ATOM", messages: [], context: { sessionId: `task-retry-${next}`, requestId: "again", source: "text", receivedAt: new Date() } }).run({ id: "new-delegation", name: "atom_delegate", input: { subagent_type: "kame", description: "Again", prompt: "write twice" } });
    assert.equal(denied.isError, true);
    assert.equal(writes, 1);
  } finally { model.close?.(); router.close(); store.close(); rmSync(home, { recursive: true, force: true }); }
});

test("a retry with no worker start becomes a visible failed attempt and duplicate delivery stays inert", async () => {
  const store = openHelperStore({ path: ":memory:" });
  const old = store.addNativeJob("kame", "draft", { chatId: "old" }); store.fail(old.id, "limited");
  let dispatched = 0;
  let settled!: () => void; const complete = new Promise<void>((r) => { settled = r; });
  const start = taskStarter({ core: { resume() {}, async handle() { dispatched++; throw new Error("Account limit; worker never started."); } } as never, name: () => "Kame", log,
    retrySettled: (id, reason) => { store.failQueuedRetry(id, reason ?? "No worker"); settled(); } });
  const retry = nativeRetryStarter({ store, start });
  try {
    retry(old.id); retry(old.id); await complete;
    const attempt = store.get(store.get(old.id)!.retriedAs!)!;
    assert.equal(dispatched, 1); assert.equal(attempt.state, "failed");
    assert.match(attempt.error!, /Account limit/);
    assert.equal(attempt.recoveryNeeded, undefined);
    retry(old.id); assert.equal(dispatched, 1);
  } finally { store.close(); }
});

test("retry read/project/provider context follows only persisted retry ancestry", () => {
  const store = openHelperStore({ path: ":memory:" });
  try {
    const original = store.addNativeJob("kame", "draft", { chatId: "project-chat" }); store.fail(original.id, "failed");
    const first = store.queueNativeRetry(original.id).job;
    assert.equal(retrySourceChat(store, first.chatId!), "project-chat");
    store.failQueuedRetry(first.id, "limited");
    const second = store.queueNativeRetry(first.id).job;
    assert.equal(retrySourceChat(store, second.chatId!), "project-chat");
    assert.equal(retrySourceChat(store, "project-chat"), undefined);
    assert.equal(retrySourceChat(store, "task-retry-999"), undefined);
    assert.throws(() => store.addNativeJob("sid", "ordinary", { chatId: "task-retry-999" }), /no longer exists/, "retry chat names are reserved to persisted attempts");
  } finally { store.close(); }
});

test("a removed retry waiting in the turn queue cannot start a later model request", async () => {
  const store = openHelperStore({ path: ":memory:" });
  let calls = 0;
  const start = taskStarter({ core: { resume() {}, async handle() { calls++; } } as never, name: () => "Kame", log,
    retryPending: (id) => store.get(id)?.state === "queued" });
  const source = store.addNativeJob("kame", "draft", { chatId: "old" }); store.fail(source.id, "failed");
  const retry = nativeRetryStarter({ store, start });
  try {
    retry(source.id);
    store.remove(store.get(source.id)!.retriedAs!);
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(calls, 0);
    assert.throws(() => retry(source.id), /was removed/);
  } finally { store.close(); }
});
