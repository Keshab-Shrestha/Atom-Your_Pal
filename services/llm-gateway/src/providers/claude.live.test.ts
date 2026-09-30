import { test } from "node:test";
import assert from "node:assert/strict";
import { createGateway } from "../gateway.ts";
import { createClaudeAdapter } from "./claude.ts";

// Calls the real Anthropic API (costs a few tokens). Run with: pnpm test:live
const enabled = process.env.ZENO_LIVE_TESTS === "1" && !!process.env.ANTHROPIC_API_KEY;

test("live: Claude answers through the gateway", { skip: !enabled && "set ZENO_LIVE_TESTS=1 (pnpm test:live)" }, async () => {
  const gateway = createGateway({
    provider: createClaudeAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: process.env.ZENO_LLM_MODEL ?? "claude-sonnet-5",
      maxTokens: 50,
    }),
    timeoutMs: 30_000,
  });
  const reply = await gateway.complete({
    system: "Reply with exactly one word.",
    messages: [{ role: "user", content: "Say the word: ready" }],
    context: { requestId: "live", sessionId: "live", source: "text", receivedAt: new Date() },
  });
  assert.match(reply.text.toLowerCase(), /ready/);
});
