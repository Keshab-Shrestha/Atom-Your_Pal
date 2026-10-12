import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, readEnv } from "@zeno/shared";
import { createGateway } from "../gateway.ts";
import { createProviderAdapter } from "./index.ts";

// Calls Claude on the signed-in plan through the gateway (uses a little of the plan).
// Run with: pnpm test:live
const enabled = readEnv(process.env, "ATOM_LIVE_TESTS") === "1";

test("live: the configured provider answers through the gateway", { skip: !enabled && "set ATOM_LIVE_TESTS=1 (pnpm test:live)" }, async (t) => {
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
