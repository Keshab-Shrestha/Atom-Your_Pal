import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel, ModelRequest } from "@zeno/contracts";
import { CoreError, DEFAULT_SYSTEM_PROMPT, createCore } from "./core.ts";

function fakeModel(reply: (req: ModelRequest) => string | Promise<string> = (r) => `echo: ${r.messages.at(-1)!.content}`) {
  const requests: ModelRequest[] = [];
  const model: LanguageModel = {
    async complete(request) {
      requests.push(structuredClone(request));
      return { text: await reply(request) };
    },
  };
  return { model, requests };
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

test("routes input to the model with context and returns the reply", async () => {
  const { model, requests } = fakeModel();
  const now = new Date("2026-10-01T10:00:00Z");
  const core = createCore({ model, newId: ids(), now: () => now });

  const response = await core.handle({ text: "  Hello  ", source: "voice" });

  assert.deepEqual(response, { requestId: "id-2", text: "echo: Hello" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].system, DEFAULT_SYSTEM_PROMPT);
  assert.deepEqual(requests[0].messages, [{ role: "user", content: "Hello" }]);
  assert.deepEqual(requests[0].context, { requestId: "id-2", sessionId: "id-1", source: "voice", receivedAt: now });
});

test("keeps session history so follow-ups have context", async () => {
  const { model, requests } = fakeModel();
  const core = createCore({ model });
  await core.handle({ text: "My name is Keshab", source: "text" });
  await core.handle({ text: "What is my name?", source: "text" });

  assert.deepEqual(requests[1].messages, [
    { role: "user", content: "My name is Keshab" },
    { role: "assistant", content: "echo: My name is Keshab" },
    { role: "user", content: "What is my name?" },
  ]);
  assert.equal(core.history().length, 4);
});

test("history is bounded to maxTurns pairs", async () => {
  const { model, requests } = fakeModel();
  const core = createCore({ model, maxTurns: 2 });
  for (const t of ["a", "b", "c"]) await core.handle({ text: t, source: "text" });
  assert.deepEqual(core.history().map((m) => m.content), ["b", "echo: b", "c", "echo: c"]);
  await core.handle({ text: "d", source: "text" });
  assert.deepEqual(requests[3].messages.map((m) => m.content), ["b", "echo: b", "c", "echo: c", "d"]);
});

test("a failed request is not added to history", async () => {
  let fail = true;
  const { model } = fakeModel((r) => {
    if (fail) throw new Error("network down");
    return `ok: ${r.messages.at(-1)!.content}`;
  });
  const core = createCore({ model });
  await assert.rejects(core.handle({ text: "first", source: "voice" }), /network down/);
  assert.deepEqual(core.history(), []);

  fail = false;
  await core.handle({ text: "second", source: "voice" });
  assert.deepEqual(core.history().map((m) => m.content), ["second", "ok: second"]);
});

test("rejects empty input and empty replies", async () => {
  const core = createCore({ model: fakeModel(() => "   ").model });
  await assert.rejects(core.handle({ text: "   ", source: "voice" }), (e: unknown) => e instanceof CoreError && /Empty request/.test(e.message));
  await assert.rejects(core.handle({ text: "hi", source: "voice" }), /empty reply/);
  assert.deepEqual(core.history(), []);
});

test("rejects a new request while one is in flight", async () => {
  let release!: () => void;
  const { model } = fakeModel(() => new Promise((r) => (release = () => r("done"))));
  const core = createCore({ model });
  const first = core.handle({ text: "one", source: "voice" });
  await assert.rejects(core.handle({ text: "two", source: "voice" }), /Still answering/);
  release();
  assert.equal((await first).text, "done");
});

test("reset clears history and starts a new session", async () => {
  const { model, requests } = fakeModel();
  const core = createCore({ model, newId: ids() });
  await core.handle({ text: "hi", source: "text" });
  const before = core.sessionId;
  core.reset();
  assert.notEqual(core.sessionId, before);
  assert.deepEqual(core.history(), []);
  await core.handle({ text: "again", source: "text" });
  assert.deepEqual(requests[1].messages, [{ role: "user", content: "again" }]);
  assert.equal(requests[1].context.sessionId, core.sessionId);
});

test("a reply that arrives after reset is not added to the new session", async () => {
  let release!: () => void;
  const { model } = fakeModel(() => new Promise((r) => (release = () => r("late"))));
  const core = createCore({ model });
  const pending = core.handle({ text: "old question", source: "voice" });
  core.reset();
  release();
  await pending;
  assert.deepEqual(core.history(), []);
});

test("passes the cancel signal to the model; a cancelled exchange is not recorded", async () => {
  let seen: AbortSignal | undefined;
  const model: LanguageModel = {
    async complete(_request, signal) {
      seen = signal;
      return { text: "late reply" };
    },
  };
  const core = createCore({ model, newId: ids() });
  const controller = new AbortController();
  const pending = core.handle({ text: "hello", source: "voice" }, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(seen, controller.signal);
  assert.deepEqual(core.history(), []);
  // and the Core is free for the next request
  assert.equal((await core.handle({ text: "again", source: "voice" })).text, "late reply");
});
