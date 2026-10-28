import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryStore } from "@atom/memory";
import type { Message, ToolRunner } from "@atom/contracts";
import { createGateway, createCodexSessionAdapter, type SessionSdk } from "@atom/llm-gateway";
import { fakeCodex } from "../../../tests/codex-harness.ts";
import { createNativeCore } from "./native-core.ts";
import { createCodexToolRouter } from "./codex-tools.ts";

const tools: ToolRunner = { specs: () => [], run: async (c) => ({ callId: c.id, content: "unavailable", isError: true }) };
const oldMessages = (): Message[] => [{ role: "user", content: "The fictional Cedar launch is Wednesday." }, { role: "assistant", content: "Agreed." }, ...Array.from({ length: 80 }, (_, i): Message => ({ role: i % 2 ? "assistant" : "user", content: `Unrelated discussion ${i}. ` + "x".repeat(200) }))];

test("reopened Codex recovers an omitted fact through checked RPC history tools, then Claude recovers it after a provider change", async () => {
  const memory = openMemoryStore({ path: ":memory:" });
  memory.chats.save("cedar", oldMessages());
  const fake = fakeCodex(async ({ text, call, start }) => {
    assert.doesNotMatch(text, /launch is Wednesday/);
    assert.match(text, /earlier saved messages.*omitted/);
    assert.ok(start.dynamicTools.some((s: { name: string }) => s.name === "atom_read_chat_history"));
    const found = await call("atom_search_chat_history", { query: "fictional Cedar" });
    const hit = JSON.parse(found.contentItems[0].text).hits[0];
    assert.equal(hit.id, "m1");
    const read = await call("atom_read_chat_history", { message: 1 });
    assert.match(read.contentItems[0].text, /launch is Wednesday/);
    return "Cedar launches Wednesday.";
  });
  const router = createCodexToolRouter({ program: "fake", model: "codex-default", tools });
  const gateway = createGateway({ provider: createCodexSessionAdapter({ program: "fake", model: "codex-default", runner: (r) => router.forRequest(r), transport: fake.factory }), timeoutMs: 5000, maxRetries: 0 });
  const base = { claudePath: "fake", tools, replayBytes: 1000, archived: (id: string) => memory.chats.messages(id), onExchange: (id: string, messages: readonly Message[]) => memory.chats.save(id, messages) };
  const core = createNativeCore({ ...base, modelFor: () => undefined, toolModel: () => gateway });
  let claudeRead = false;
  const sdk: SessionSdk = {
    tool: (name, _description, _schema, handler) => ({ name, handler }) as never,
    createSdkMcpServer: (options) => ({ type: "sdk", ...options }) as never,
    query({ prompt, options }) {
      async function* run() {
        yield { type: "system", subtype: "init", apiKeySource: "none", session_id: "claude-cedar" };
        for await (const message of prompt) {
          assert.doesNotMatch(String((message.message as any).content), /launch is Wednesday/);
          const server = (options.mcpServers as any).atom;
          const search = server.tools.find((t: any) => t.name === "search_chat_history");
          const read = server.tools.find((t: any) => t.name === "read_chat_history");
          assert.equal(JSON.parse((await search.handler({ query: "fictional Cedar" })).content[0].text).hits[0].id, "m1");
          assert.match((await read.handler({ message: 1 })).content[0].text, /launch is Wednesday/);
          claudeRead = true;
          yield { type: "result", subtype: "success", is_error: false, result: "Cedar launches Wednesday.", session_id: "claude-cedar" };
        }
      }
      return Object.assign(run(), { close() {} });
    },
  };
  const reopened = createNativeCore({ ...base, modelFor: () => "claude-test", sdk });
  try {
    core.resume("cedar", memory.chats.messages("cedar"));
    assert.match((await core.handle({ text: "What was our launch day?", source: "text" })).text, /Wednesday/);
    assert.match((await core.handle({ text: "Confirm that day once more.", source: "text" })).text, /Wednesday/);
    assert.equal(fake.wires.length, 1, "the bounded window retains the live Codex prefix across the next turn");
    reopened.resume("cedar", memory.chats.messages("cedar"));
    assert.match((await reopened.handle({ text: "Remind me of our launch day.", source: "text" })).text, /Wednesday/);
    assert.equal(claudeRead, true);
    assert.equal(memory.chats.messages("cedar").length, oldMessages().length + 6);
    assert.deepEqual(memory.chats.messages("cedar").slice(0, oldMessages().length), oldMessages());
  } finally { gateway.close?.(); router.close(); reopened.reset(); memory.close(); }
});

test("a captured history runner stays bound to its chat after switching, and cannot expose another chat or a removed archive", async () => {
  const memory = openMemoryStore({ path: ":memory:" });
  let captured: ToolRunner | undefined;
  const core = createNativeCore({ claudePath: "", tools, modelFor: () => undefined, toolModel: () => ({ complete: async (request) => (captured ??= request.historyTools, { text: "ok" }) }), archived: (id) => memory.chats.messages(id), onExchange: (id, messages) => memory.chats.save(id, messages) });
  try {
    core.resume("one", [{ role: "user", content: "FIRST-CHAT-ONLY" }]);
    await core.handle({ text: "Continue.", source: "text" });
    core.resume("two", [{ role: "user", content: "OTHER-CHAT-ONLY" }]);
    await core.handle({ text: "Continue.", source: "text" });
    const result = await captured!.run({ id: "r", name: "read_chat_history", input: {} });
    assert.match(result.content, /FIRST-CHAT-ONLY/);
    assert.doesNotMatch(result.content, /OTHER-CHAT-ONLY/);
    assert.equal((await captured!.run({ id: "r", name: "read_chat_history", input: { chat: "two" } })).isError, true);
    memory.chats.remove("one");
    assert.deepEqual(JSON.parse((await captured!.run({ id: "r", name: "read_chat_history", input: {} })).content).messages, []);
  } finally { memory.close(); }
});

test("a tool-free provider gets an omission notice, not pretend history tools, and an oversized question preserves the archive", async () => {
  let calls = 0;
  const core = createNativeCore({ claudePath: "", tools, replayBytes: 1000, modelFor: () => undefined, otherModel: () => ({ complete: async (request) => {
    calls++; assert.equal(request.historyTools, undefined);
    assert.match(request.systemExtra!, /no archive tools/);
    assert.doesNotMatch(JSON.stringify(request.messages), /launch is Wednesday/);
    return { text: "Please switch this chat to Claude or Codex to recover that detail." };
  } }) });
  core.resume("plain", oldMessages());
  await core.handle({ text: "Which day?", source: "text" });
  const saved = structuredClone(core.history());
  await assert.rejects(core.handle({ text: "z".repeat(1100), source: "text" }), /Shorten it or attach/);
  assert.equal(calls, 1);
  assert.deepEqual(core.history(), saved);
});
