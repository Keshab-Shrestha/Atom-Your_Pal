import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import type { ModelRequest } from "@zeno/contracts";
import { ProviderError, createGateway, GatewayError } from "../gateway.ts";
import { createClaudeAdapter, type ClaudeClient } from "./claude.ts";

const request: ModelRequest = {
  system: "Be brief.",
  messages: [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello!" },
    { role: "user", content: "How are you?" },
  ],
  context: { requestId: "r", sessionId: "s", source: "voice", receivedAt: new Date(0) },
};

function fakeClient(result: () => unknown) {
  const calls: Array<{ body: unknown; options: unknown }> = [];
  const client: ClaudeClient = {
    messages: {
      async create(body, options) {
        calls.push({ body, options });
        return result() as never;
      },
    },
  };
  return { client, calls };
}

function apiError(status: number, message: string) {
  return Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message } }, undefined, new Headers());
}

test("maps the request to the Messages API and joins text blocks", async () => {
  const { client, calls } = fakeClient(() => ({
    content: [
      { type: "text", text: "I'm " },
      { type: "text", text: "well. " },
    ],
  }));
  const adapter = createClaudeAdapter({ apiKey: "k", model: "claude-test", client });
  const signal = new AbortController().signal;

  assert.deepEqual(await adapter.complete(request, signal), { text: "I'm well." });
  assert.equal(adapter.name, "claude");
  assert.deepEqual(calls[0].body, {
    model: "claude-test",
    max_tokens: 1024,
    system: "Be brief.",
    messages: request.messages,
  });
  assert.deepEqual(calls[0].options, { signal });
});

test("ignores non-text content blocks", async () => {
  const { client } = fakeClient(() => ({ content: [{ type: "thinking" }, { type: "text", text: "Answer" }] }));
  const adapter = createClaudeAdapter({ apiKey: "k", model: "m", client });
  assert.equal((await adapter.complete(request, new AbortController().signal)).text, "Answer");
});

const cases: Array<[number, string, RegExp]> = [
  [401, "auth", /HTTP 401: invalid x-api-key Check ANTHROPIC_API_KEY/],
  [403, "auth", /HTTP 403/],
  [429, "rate_limit", /HTTP 429/],
  [529, "unavailable", /HTTP 529/],
  [500, "unavailable", /HTTP 500/],
  [400, "bad_request", /HTTP 400/],
  [404, "bad_request", /Check ZENO_LLM_MODEL \("m"\)/],
];

for (const [status, kind, pattern] of cases) {
  test(`HTTP ${status} becomes a "${kind}" ProviderError`, async () => {
    const { client } = fakeClient(() => {
      throw apiError(status, status === 401 ? "invalid x-api-key" : "failed");
    });
    const adapter = createClaudeAdapter({ apiKey: "k", model: "m", client });
    await assert.rejects(adapter.complete(request, new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, kind);
      assert.match(error.message, pattern);
      return true;
    });
  });
}

test("connection failures are unavailable", async () => {
  const { client } = fakeClient(() => {
    throw new Anthropic.APIConnectionError({ message: "ECONNREFUSED" });
  });
  const adapter = createClaudeAdapter({ apiKey: "k", model: "m", client });
  await assert.rejects(adapter.complete(request, new AbortController().signal), (e: unknown) => e instanceof ProviderError && e.kind === "unavailable");
});

test("through the gateway, an aborted call is reported as a timeout", async () => {
  const client: ClaudeClient = {
    messages: {
      create: (_body, options) =>
        new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()))),
    },
  };
  const gateway = createGateway({ provider: createClaudeAdapter({ apiKey: "k", model: "m", client }), timeoutMs: 20 });
  await assert.rejects(gateway.complete(request), (e: unknown) => e instanceof GatewayError && e.kind === "timeout");
});

test("refusals, empty, and unreadable replies are explained, never passed on as empty", async () => {
  const kinds: Array<[unknown, string, RegExp]> = [
    [{ content: [], stop_reason: "refusal" }, "bad_request", /declined to answer this \(reason: refusal\)/],
    [{ content: [{ type: "text", text: "  " }], stop_reason: "max_tokens" }, "bad_request", /cut off/],
    [{ content: [{ type: "tool_use" }], stop_reason: "tool_use" }, "bad_request", /returned no text \(reason: tool_use\)/],
    [{ stop_reason: "end_turn" }, "unknown", /Claude sent a reply ZENO could not read/],
    [undefined, "unknown", /could not read/],
  ];
  for (const [result, kind, message] of kinds) {
    const adapter = createClaudeAdapter({ apiKey: "k", model: "m", client: fakeClient(() => result).client });
    await assert.rejects(adapter.complete(request, new AbortController().signal), (e: unknown) => {
      assert.ok(e instanceof ProviderError, String(e));
      assert.equal(e.kind, kind);
      assert.match(e.message, message);
      return true;
    });
  }
});

// ---- tools (ADR-054, Task 0.6.1) ----

const timeSpec = { name: "current_time", description: "time", inputSchema: { type: "object" as const } };

test("offers tools to Claude as name, description and input_schema", async () => {
  const { client, calls } = fakeClient(() => ({ content: [{ type: "text", text: "ok" }] }));
  await createClaudeAdapter({ apiKey: "k", model: "m", client }).complete({ ...request, tools: [timeSpec] }, new AbortController().signal);
  assert.deepEqual((calls[0].body as { tools: unknown }).tools, [
    { name: "current_time", description: "time", input_schema: { type: "object" } },
  ]);
});

test("sends no tools field when there are none", async () => {
  const { client, calls } = fakeClient(() => ({ content: [{ type: "text", text: "ok" }] }));
  await createClaudeAdapter({ apiKey: "k", model: "m", client }).complete(request, new AbortController().signal);
  assert.equal("tools" in (calls[0].body as object), false);
});

test("reads tool_use blocks as tool calls, even with no text", async () => {
  const { client } = fakeClient(() => ({
    content: [{ type: "tool_use", id: "toolu_1", name: "current_time", input: { timezone: "Asia/Tokyo" } }],
    stop_reason: "tool_use",
  }));
  const reply = await createClaudeAdapter({ apiKey: "k", model: "m", client }).complete(request, new AbortController().signal);
  assert.deepEqual(reply, { text: "", toolCalls: [{ id: "toolu_1", name: "current_time", input: { timezone: "Asia/Tokyo" } }] });
});

test("sends tool calls and results back as Anthropic content blocks", async () => {
  const { client, calls } = fakeClient(() => ({ content: [{ type: "text", text: "It is 9." }] }));
  await createClaudeAdapter({ apiKey: "k", model: "m", client }).complete(
    {
      ...request,
      messages: [
        { role: "user", content: "time?" },
        { role: "assistant", content: "Checking.", toolCalls: [{ id: "t1", name: "current_time", input: {} }] },
        { role: "user", content: "", toolResults: [{ callId: "t1", content: "failed", isError: true }] },
      ],
      tools: [timeSpec],
    },
    new AbortController().signal,
  );
  assert.deepEqual((calls[0].body as { messages: unknown }).messages, [
    { role: "user", content: "time?" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Checking." },
        { type: "tool_use", id: "t1", name: "current_time", input: {} },
      ],
    },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "failed", is_error: true }] },
  ]);
});
