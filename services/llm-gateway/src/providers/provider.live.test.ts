import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "@zeno/shared";
import { createGateway } from "../gateway.ts";
import { createProviderAdapter } from "./index.ts";

// Calls the real provider API selected by ZENO_LLM_PROVIDER (costs a few tokens).
// Run with: pnpm test:live   (or ZENO_LLM_PROVIDER=gemini pnpm test:live)
const enabled = process.env.ZENO_LIVE_TESTS === "1";

test("live: the configured provider answers through the gateway", { skip: !enabled && "set ZENO_LIVE_TESTS=1 (pnpm test:live)" }, async (t) => {
  const { llm } = loadConfig();
  t.diagnostic(`provider=${llm.provider} model=${llm.model}`);
  const gateway = createGateway({ provider: createProviderAdapter(llm), timeoutMs: llm.timeoutMs });
  const started = Date.now();
  const reply = await gateway.complete({
    system: "Reply with exactly one word.",
    messages: [{ role: "user", content: "Say the word: ready" }],
    context: { requestId: "live", sessionId: "live", source: "text", receivedAt: new Date() },
  });
  t.diagnostic(`reply="${reply.text}" in ${Date.now() - started} ms`);
  assert.match(reply.text.toLowerCase(), /ready/);
});
