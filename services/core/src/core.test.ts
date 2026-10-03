import { test } from "node:test";
import assert from "node:assert/strict";
import type { LanguageModel, ModelRequest, ModelResponse, ToolRunner } from "@zeno/contracts";
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

// ---- tool calling (ADR-054, Task 0.6.1) ----

function scriptedModel(steps: Array<(req: ModelRequest) => ModelResponse>) {
  const requests: ModelRequest[] = [];
  const model: LanguageModel = {
    async complete(request) {
      requests.push(structuredClone(request));
      const step = steps[requests.length - 1];
      if (!step) throw new Error("model called more often than scripted");
      return step(request);
    },
  };
  return { model, requests };
}

function fakeTools(run: ToolRunner["run"] = async (call) => ({ callId: call.id, content: "12:00" })) {
  const calls: string[] = [];
  const tools: ToolRunner = {
    specs: () => [{ name: "current_time", description: "time", inputSchema: { type: "object" } }],
    async run(call, signal) {
      calls.push(call.name);
      return run(call, signal);
    },
  };
  return { tools, calls };
}

test("runs the tool the model asks for, then returns its final answer", async () => {
  const { model, requests } = scriptedModel([
    () => ({ text: "", toolCalls: [{ id: "t1", name: "current_time", input: {} }] }),
    () => ({ text: "It is noon." }),
  ]);
  const { tools, calls } = fakeTools();
  const core = createCore({ model, tools });

  const response = await core.handle({ text: "What time is it?", source: "voice" });

  assert.equal(response.text, "It is noon.");
  assert.deepEqual(calls, ["current_time"]);
  assert.equal(requests[0].tools?.[0].name, "current_time");
  const second = requests[1].messages;
  assert.deepEqual(second[1], { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "current_time", input: {} }] });
  assert.deepEqual(second[2], { role: "user", content: "", toolResults: [{ callId: "t1", content: "12:00" }] });
});

test("session history keeps only the question and the final answer", async () => {
  const { model } = scriptedModel([
    () => ({ text: "", toolCalls: [{ id: "t1", name: "current_time", input: {} }] }),
    () => ({ text: "It is noon." }),
  ]);
  const core = createCore({ model, tools: fakeTools().tools });
  await core.handle({ text: "What time is it?", source: "voice" });
  assert.deepEqual(core.history(), [
    { role: "user", content: "What time is it?" },
    { role: "assistant", content: "It is noon." },
  ]);
});

test("a failing tool is reported to the model, which can still answer", async () => {
  const { model, requests } = scriptedModel([
    () => ({ text: "", toolCalls: [{ id: "t1", name: "current_time", input: {} }] }),
    () => ({ text: "I could not check the time." }),
  ]);
  const { tools } = fakeTools(async (call) => ({ callId: call.id, content: "failed", isError: true }));
  const response = await createCore({ model, tools }).handle({ text: "time?", source: "text" });
  assert.equal(response.text, "I could not check the time.");
  assert.equal(requests[1].messages[2].toolResults?.[0].isError, true);
});

test("several tool calls in one turn run in order", async () => {
  const order: string[] = [];
  const { model } = scriptedModel([
    () => ({ text: "", toolCalls: [{ id: "a", name: "current_time", input: {} }, { id: "b", name: "current_time", input: {} }] }),
    () => ({ text: "done" }),
  ]);
  const { tools } = fakeTools(async (call) => {
    order.push(`start ${call.id}`);
    await new Promise((r) => setTimeout(r, call.id === "a" ? 10 : 0));
    order.push(`end ${call.id}`);
    return { callId: call.id, content: "x" };
  });
  await createCore({ model, tools }).handle({ text: "go", source: "text" });
  assert.deepEqual(order, ["start a", "end a", "start b", "end b"]);
});

test("a model that keeps asking for tools is stopped, then asked once, without tools, to tell the user where it got stuck", async () => {
  const loop = () => ({ text: "", toolCalls: [{ id: "t", name: "current_time", input: {} }] });
  const seen: Array<{ tools: unknown; system: string }> = [];
  const wrapUp = (req: any) => {
    seen.push({ tools: req.tools, system: req.system });
    return { text: "I could not finish: Brave has two windows open." };
  };
  const { model } = scriptedModel([loop, loop, loop, loop, wrapUp]);
  const { tools, calls } = fakeTools();
  const core = createCore({ model, tools, maxToolRounds: 3 });
  const reply = await core.handle({ text: "go", source: "text" });
  assert.equal(reply.text, "I could not finish: Brave has two windows open.");
  assert.equal(calls.length, 3, "no tool ran after the limit");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tools, undefined, "the wrap-up call offers no tools");
  assert.match(seen[0].system, /out of steps/i);
  assert.equal(core.history().length, 2);
  // The core is usable again afterwards.
  const next = scriptedModel([() => ({ text: "ok" })]);
  assert.equal((await createCore({ model: next.model, tools }).handle({ text: "hi", source: "text" })).text, "ok");
});

test("if the wrap-up gives no words, the request still fails plainly", async () => {
  const loop = () => ({ text: "", toolCalls: [{ id: "t", name: "current_time", input: {} }] });
  const { model } = scriptedModel(Array.from({ length: 10 }, () => loop));
  const { tools, calls } = fakeTools();
  const core = createCore({ model, tools, maxToolRounds: 3 });
  await assert.rejects(core.handle({ text: "go", source: "text" }), /too many steps/);
  assert.equal(calls.length, 3);
  assert.deepEqual(core.history(), []);
});

test("cancelling between tool steps stops the request and keeps no history", async () => {
  const ac = new AbortController();
  const { model, requests } = scriptedModel([
    () => ({ text: "", toolCalls: [{ id: "t1", name: "current_time", input: {} }] }),
    () => ({ text: "never" }),
  ]);
  const { tools } = fakeTools(async (call) => {
    ac.abort();
    return { callId: call.id, content: "x" };
  });
  const core = createCore({ model, tools });
  await assert.rejects(core.handle({ text: "go", source: "text" }, ac.signal), /cancelled/);
  assert.equal(requests.length, 1);
  assert.deepEqual(core.history(), []);
});

test("without tools the request offers none and tool calls are not run", async () => {
  const { model, requests } = fakeModel();
  await createCore({ model }).handle({ text: "hi", source: "text" });
  assert.equal("tools" in requests[0], false);
});

test("context: extra text joins the system prompt for that request only; a failing provider is ignored", async () => {
  const { model, requests } = fakeModel();
  let calls = 0;
  const core = createCore({
    model,
    context: (input, context) => {
      calls++;
      if (input.text === "boom") throw new Error("store gone");
      return input.text === "tea" ? `Known: likes tea (${context.source})` : undefined;
    },
  });
  await core.handle({ text: " tea ", source: "voice" });
  await core.handle({ text: "hello", source: "voice" });
  await core.handle({ text: "boom", source: "text" });
  assert.equal(calls, 3);
  assert.equal(requests[0].system, `${DEFAULT_SYSTEM_PROMPT}\n\nKnown: likes tea (voice)`);
  assert.equal(requests[1].system, DEFAULT_SYSTEM_PROMPT);
  assert.equal(requests[2].system, DEFAULT_SYSTEM_PROMPT);
});

test("context: tool rounds keep the same system prompt", async () => {
  let n = 0;
  const requests: ModelRequest[] = [];
  const model: LanguageModel = {
    async complete(request) {
      requests.push(structuredClone(request));
      return n++ === 0 ? { text: "", toolCalls: [{ id: "c1", name: "t", input: {} }] } : { text: "done" };
    },
  };
  const tools: ToolRunner = { specs: () => [{ name: "t", description: "", inputSchema: { type: "object" } }], run: async (c) => ({ callId: c.id, content: "ok" }) };
  const core = createCore({ model, tools, context: () => "Known: X" });
  await core.handle({ text: "go", source: "text" });
  assert.equal(requests.length, 2);
  for (const r of requests) assert.ok(r.system.endsWith("Known: X"));
});
