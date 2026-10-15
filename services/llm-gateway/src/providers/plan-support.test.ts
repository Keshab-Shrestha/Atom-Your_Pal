import { test } from "node:test";
import assert from "node:assert/strict";
import { planGuard, scrubbedEnv } from "./plan-support.ts";
import { ProviderError } from "../gateway.ts";

// 2026-10-16 (test audit): these two guards keep a stray API key from turning the plan's flat use into billed API use. They had no direct test.

test("scrubbedEnv drops every key that could switch Claude Code to billed API use or another provider, and keeps the rest", () => {
  const out = scrubbedEnv({
    ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "https://proxy",
    CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1", CLAUDE_CODE_OAUTH_TOKEN: "o", CLAUDE_CODE_SKIP_AUTH: "1", CLAUDE_CODE_API_KEY_HELPER_TTL_MS: "5",
    AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b", GEMINI_API_KEY: "g", GOOGLE_API_KEY: "g", OPENAI_API_KEY: "o",
    PATH: "/usr/bin", HOME: "/Users/k", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ENABLE_TOOL_SEARCH: "force", MISSING: undefined,
  });
  assert.deepEqual(out, { PATH: "/usr/bin", HOME: "/Users/k", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ENABLE_TOOL_SEARCH: "force" });
});

test("planGuard stops a session that uses an API key, and lets plan sign-in through", () => {
  assert.throws(() => planGuard({ type: "system", apiKeySource: "ANTHROPIC_API_KEY" }), (e: unknown) => e instanceof ProviderError && /bills per token/.test(e.message));
  assert.throws(() => planGuard({ type: "system", apiKeySource: "" }), ProviderError, "unknown counts as not the plan");
  assert.throws(() => planGuard({ type: "system" }), ProviderError);
  assert.doesNotThrow(() => planGuard({ type: "system", apiKeySource: "none" }));
  assert.doesNotThrow(() => planGuard({ type: "system", apiKeySource: "oauth" }));
});

test("planGuard stops when the plan is used up and Claude would charge extra, or the limit is reached; it reports plan use first", () => {
  const seen: unknown[] = [];
  assert.doesNotThrow(() => planGuard({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.4 }, seven_day: { utilization: 0.1 } }, isUsingOverage: false } }, (u) => seen.push(u)));
  assert.deepEqual(seen, [{ fiveHour: 0.4, sevenDay: 0.1, overage: false }]);
  assert.throws(() => planGuard({ type: "rate_limit_event", rate_limit_info: { isUsingOverage: true } }), (e: unknown) => e instanceof ProviderError && /extra usage/.test(e.message));
  assert.throws(() => planGuard({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 0 } }), (e: unknown) => e instanceof ProviderError && /limit is reached/.test(e.message));
  assert.doesNotThrow(() => planGuard({ type: "assistant" }), "a message with no rate-limit info is fine");
});
