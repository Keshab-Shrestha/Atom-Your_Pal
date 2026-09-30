import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function startZeno(env: Record<string, string>) {
  return spawnSync(process.execPath, ["apps/mac/src/main.ts"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("ZENO starts with valid configuration", () => {
  const result = startZeno({ ZENO_LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "test-key" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ZENO Phase 0: started/);
});

test("ZENO exits with a clear error when configuration is invalid", () => {
  const result = startZeno({ ZENO_LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid configuration:/);
  assert.match(result.stderr, /ANTHROPIC_API_KEY is required/);
});
