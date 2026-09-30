import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, loadConfig } from "./config.ts";

const KEY = "sk-ant-test-secret-value";

test("applies defaults when only the API key is set", () => {
  const config = loadConfig({ ANTHROPIC_API_KEY: KEY });
  assert.deepEqual(config, {
    llm: { apiKey: KEY, model: "claude-sonnet-5", timeoutMs: 30_000 },
    audio: { inputDevice: ":default", sampleRate: 16_000 },
    log: { level: "info" },
  });
});

test("reads overrides from the environment", () => {
  const config = loadConfig({
    ANTHROPIC_API_KEY: KEY,
    ZENO_LLM_MODEL: "some-model",
    ZENO_LLM_TIMEOUT_MS: "5000",
    ZENO_AUDIO_INPUT_DEVICE: ":1",
    ZENO_AUDIO_SAMPLE_RATE: "48000",
    ZENO_LOG_LEVEL: "debug",
  });
  assert.equal(config.llm.model, "some-model");
  assert.equal(config.llm.timeoutMs, 5000);
  assert.equal(config.audio.inputDevice, ":1");
  assert.equal(config.audio.sampleRate, 48000);
  assert.equal(config.log.level, "debug");
});

test("missing or blank API key is an error", () => {
  for (const value of [undefined, "", "   "]) {
    assert.throws(() => loadConfig({ ANTHROPIC_API_KEY: value }), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.deepEqual(error.problems, ["ANTHROPIC_API_KEY is required (set it in .env)"]);
      return true;
    });
  }
});

test("reports every problem at once", () => {
  assert.throws(
    () =>
      loadConfig({
        ZENO_LLM_TIMEOUT_MS: "soon",
        ZENO_AUDIO_SAMPLE_RATE: "-1",
        ZENO_LOG_LEVEL: "loud",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.problems.length, 4);
      assert.match(error.message, /ANTHROPIC_API_KEY is required/);
      assert.match(error.message, /ZENO_LLM_TIMEOUT_MS must be a positive integer, got "soon"/);
      assert.match(error.message, /ZENO_AUDIO_SAMPLE_RATE must be a positive integer, got "-1"/);
      assert.match(error.message, /ZENO_LOG_LEVEL must be one of debug, info, warn, error, got "loud"/);
      return true;
    },
  );
});

test("never includes the API key in error messages", () => {
  assert.throws(
    () => loadConfig({ ANTHROPIC_API_KEY: KEY, ZENO_LOG_LEVEL: "loud" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.ok(!error.message.includes(KEY));
      return true;
    },
  );
});
