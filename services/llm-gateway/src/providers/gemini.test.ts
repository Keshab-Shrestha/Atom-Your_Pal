import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, ThinkingLevel } from "@google/genai";
import type { ModelRequest } from "@zeno/contracts";
import { GatewayError, ProviderError, createGateway } from "../gateway.ts";
import { createGeminiAdapter, type GeminiClient } from "./gemini.ts";

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
  const calls: unknown[] = [];
  const client: GeminiClient = {
    models: {
      async generateContent(params) {
        calls.push(params);
        return result() as never;
      },
    },
  };
  return { client, calls };
}

function apiError(status: number, message: string) {
  return new ApiError({ status, message: JSON.stringify({ error: { code: status, message, status: "X" } }) });
}

const signal = () => new AbortController().signal;

test("maps roles and system prompt to generateContent and returns the text", async () => {
  const { client, calls } = fakeClient(() => ({ text: " I'm well. " }));
  const adapter = createGeminiAdapter({ apiKey: "k", model: "gemini-test", client });
  const s = signal();

  assert.deepEqual(await adapter.complete(request, s), { text: "I'm well." });
  assert.equal(adapter.name, "gemini");
  assert.deepEqual(calls[0], {
    model: "gemini-test",
    contents: [
      { role: "user", parts: [{ text: "Hi" }] },
      { role: "model", parts: [{ text: "Hello!" }] },
      { role: "user", parts: [{ text: "How are you?" }] },
    ],
    config: { systemInstruction: "Be brief.", abortSignal: s, thinkingConfig: { thinkingLevel: "MINIMAL" } },
  });
});

test("thinking level can be raised", async () => {
  const { client, calls } = fakeClient(() => ({ text: "ok" }));
  await createGeminiAdapter({ apiKey: "k", model: "m", thinkingLevel: ThinkingLevel.HIGH, client }).complete(request, signal());
  assert.deepEqual((calls[0] as { config: { thinkingConfig: unknown } }).config.thinkingConfig, { thinkingLevel: "HIGH" });
});

test("quota errors keep only Google's first line", async () => {
  const long =
    "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/x. \n* Quota exceeded for metric: free_tier_requests, limit: 5\nPlease retry in 11s.";
  const { client } = fakeClient(() => {
    throw apiError(429, long);
  });
  await assert.rejects(createGeminiAdapter({ apiKey: "k", model: "m", client }).complete(request, signal()), (e: unknown) => {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.kind, "rate_limit");
    assert.equal(e.message, "HTTP 429: You exceeded your current quota, please check your plan and billing details.");
    return true;
  });
});

test("passes maxOutputTokens only when set", async () => {
  const { client, calls } = fakeClient(() => ({ text: "ok" }));
  await createGeminiAdapter({ apiKey: "k", model: "m", maxTokens: 50, client }).complete(request, signal());
  assert.equal((calls[0] as { config: { maxOutputTokens?: number } }).config.maxOutputTokens, 50);
});

test("a blocked reply is a clear error", async () => {
  const { client } = fakeClient(() => ({ text: undefined, promptFeedback: { blockReason: "SAFETY" } }));
  const adapter = createGeminiAdapter({ apiKey: "k", model: "m", client });
  await assert.rejects(adapter.complete(request, signal()), (e: unknown) => e instanceof ProviderError && e.kind === "bad_request" && /reason: SAFETY/.test(e.message));
});

const cases: Array<[number, string, string, RegExp]> = [
  [400, "API key not valid. Please pass a valid API key.", "auth", /HTTP 400: API key not valid\. Please pass a valid API key\. Check GEMINI_API_KEY/],
  [403, "Permission denied", "auth", /HTTP 403/],
  [429, "Resource exhausted", "rate_limit", /HTTP 429: Resource exhausted/],
  [503, "The model is overloaded", "unavailable", /HTTP 503/],
  [404, "models/x is not found", "bad_request", /Check ZENO_LLM_MODEL \("m"\)/],
  [400, "Invalid argument", "bad_request", /HTTP 400: Invalid argument$/],
];

for (const [status, message, kind, pattern] of cases) {
  test(`HTTP ${status} "${message}" becomes a "${kind}" ProviderError`, async () => {
    const { client } = fakeClient(() => {
      throw apiError(status, message);
    });
    const adapter = createGeminiAdapter({ apiKey: "k", model: "m", client });
    await assert.rejects(adapter.complete(request, signal()), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, kind);
      assert.match(error.message, pattern);
      return true;
    });
  });
}

test("network failures are unavailable", async () => {
  const { client } = fakeClient(() => {
    throw new TypeError("fetch failed");
  });
  const adapter = createGeminiAdapter({ apiKey: "k", model: "m", client });
  await assert.rejects(adapter.complete(request, signal()), (e: unknown) => e instanceof ProviderError && e.kind === "unavailable");
});

test("through the gateway, an aborted call is reported as a timeout", async () => {
  const client: GeminiClient = {
    models: {
      generateContent: (params) =>
        new Promise((_resolve, reject) => params.config.abortSignal.addEventListener("abort", () => reject(new Error("aborted")))),
    },
  };
  const gateway = createGateway({ provider: createGeminiAdapter({ apiKey: "k", model: "m", client }), timeoutMs: 20 });
  await assert.rejects(gateway.complete(request), (e: unknown) => e instanceof GatewayError && e.kind === "timeout");
});

test("a model that rejects MINIMAL thinking is retried at LOW, and LOW is remembered", async () => {
  const levels: string[] = [];
  const client: GeminiClient = {
    models: {
      async generateContent(params) {
        const level = params.config.thinkingConfig!.thinkingLevel;
        levels.push(level);
        if (level === ThinkingLevel.MINIMAL) {
          throw apiError(400, "Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.");
        }
        return { text: "ok" };
      },
    },
  };
  const adapter = createGeminiAdapter({ apiKey: "k", model: "m", client });
  assert.deepEqual(await adapter.complete(request, signal()), { text: "ok" });
  assert.deepEqual(await adapter.complete(request, signal()), { text: "ok" });
  assert.deepEqual(levels, ["MINIMAL", "LOW", "LOW"]);
});

test("a used-up daily quota says when it resets and what to do", async () => {
  const daily = new ApiError({
    status: 429,
    message: JSON.stringify({
      error: { code: 429, message: "You exceeded your current quota.", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] },
    }),
  });
  const { client } = fakeClient(() => {
    throw daily;
  });
  await assert.rejects(createGeminiAdapter({ apiKey: "k", model: "gemini-x", client }).complete(request, signal()), (e: unknown) => {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.kind, "rate_limit");
    assert.match(e.message, /today's request quota for gemini-x is used up \(resets at midnight Pacific time\)/);
    assert.match(e.message, /ZENO_LLM_MODEL/);
    return true;
  });
});

test("empty, cut-off, and unreadable replies are explained, never passed on as empty", async () => {
  const kinds: Array<[unknown, string, RegExp]> = [
    [{ text: "", candidates: [{ finishReason: "STOP" }] }, "bad_request", /returned no text \(reason: STOP\)/],
    [{ text: undefined, candidates: [{ finishReason: "MAX_TOKENS" }] }, "bad_request", /cut off.*Try asking for a shorter answer/],
    [{ text: undefined, promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }, "bad_request", /declined to answer this/],
    [{}, "bad_request", /returned no text \(reason: none\)/],
    [null, "unknown", /Gemini sent a reply ZENO could not read/],
  ];
  for (const [result, kind, message] of kinds) {
    const adapter = createGeminiAdapter({ apiKey: "k", model: "m", client: fakeClient(() => result).client });
    await assert.rejects(adapter.complete(request, signal()), (e: unknown) => {
      assert.ok(e instanceof ProviderError, String(e));
      assert.equal(e.kind, kind);
      assert.match(e.message, message);
      return true;
    });
  }
});

// ---- tools (ADR-054, Task 0.6.1) ----

const timeSpec = { name: "current_time", description: "time", inputSchema: { type: "object" as const } };

test("offers tools to Gemini as function declarations", async () => {
  const { client, calls } = fakeClient(() => ({ text: "ok" }));
  await createGeminiAdapter({ apiKey: "k", model: "m", client }).complete({ ...request, tools: [timeSpec] }, signal());
  assert.deepEqual((calls[0] as { config: { tools: unknown } }).config.tools, [
    { functionDeclarations: [{ name: "current_time", description: "time", parametersJsonSchema: { type: "object" } }] },
  ]);
});

test("sends no tools field when there are none", async () => {
  const { client, calls } = fakeClient(() => ({ text: "ok" }));
  await createGeminiAdapter({ apiKey: "k", model: "m", client }).complete(request, signal());
  assert.equal("tools" in (calls[0] as { config: object }).config, false);
});

test("reads function calls with their id and thought signature, even with no text", async () => {
  const { client } = fakeClient(() => ({
    candidates: [{ content: { parts: [{ functionCall: { id: "f1", name: "current_time", args: { timezone: "Asia/Tokyo" } }, thoughtSignature: "SIG" }] } }],
  }));
  const reply = await createGeminiAdapter({ apiKey: "k", model: "m", client }).complete(request, signal());
  assert.deepEqual(reply, { text: "", toolCalls: [{ id: "f1", name: "current_time", input: { timezone: "Asia/Tokyo" }, signature: "SIG" }] });
});

test("makes up an id when Gemini sends none, and ignores thought text", async () => {
  const { client } = fakeClient(() => ({
    candidates: [{ content: { parts: [{ text: "hidden", thought: true }, { text: "Checking." }, { functionCall: { name: "current_time" } }] } }],
  }));
  const reply = await createGeminiAdapter({ apiKey: "k", model: "m", client }).complete(request, signal());
  assert.equal(reply.text, "Checking.");
  assert.equal(reply.toolCalls?.length, 1);
  assert.match(reply.toolCalls![0].id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(reply.toolCalls![0].input, {});
});

test("sends tool calls (with signature) and results (with the function name) back", async () => {
  const { client, calls } = fakeClient(() => ({ text: "It is 9." }));
  await createGeminiAdapter({ apiKey: "k", model: "m", client }).complete(
    {
      ...request,
      messages: [
        { role: "user", content: "time?" },
        { role: "assistant", content: "", toolCalls: [{ id: "f1", name: "current_time", input: {}, signature: "SIG" }] },
        { role: "user", content: "", toolResults: [{ callId: "f1", content: "09:00" }, { callId: "f1", content: "bad", isError: true }] },
      ],
      tools: [timeSpec],
    },
    signal(),
  );
  assert.deepEqual((calls[0] as { contents: unknown }).contents, [
    { role: "user", parts: [{ text: "time?" }] },
    { role: "model", parts: [{ functionCall: { id: "f1", name: "current_time", args: {} }, thoughtSignature: "SIG" }] },
    {
      role: "user",
      parts: [
        { functionResponse: { id: "f1", name: "current_time", response: { output: "09:00" } } },
        { functionResponse: { id: "f1", name: "current_time", response: { error: "bad" } } },
      ],
    },
  ]);
});
