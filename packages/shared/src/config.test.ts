import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, loadConfig } from "./config.ts";

// Placeholder values, not real credentials.
const CLAUDE_KEY = "test-claude-key-0000";
const GEMINI_KEY = "test-gemini-key-0000";

test("applies defaults when only the Anthropic key is set", () => {
  const config = loadConfig({ ANTHROPIC_API_KEY: CLAUDE_KEY });
  assert.deepEqual(config, {
    llm: { provider: "claude", apiKey: CLAUDE_KEY, model: "claude-sonnet-5", timeoutMs: 30_000 },
    audio: { inputDevice: ":default", sampleRate: 16_000 },
    stt: { modelPath: "models/ggml-base.en.bin", language: "en" },
    tts: { voice: "af_heart", dtype: "q8" },
    log: { level: "info" },
  });
});

test("gemini uses its own key and default model", () => {
  const config = loadConfig({ ZENO_LLM_PROVIDER: "gemini", GEMINI_API_KEY: GEMINI_KEY, ANTHROPIC_API_KEY: CLAUDE_KEY });
  assert.deepEqual(config.llm, { provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-3.5-flash", timeoutMs: 30_000 });
});

test("only the selected provider's key is required", () => {
  assert.doesNotThrow(() => loadConfig({ ZENO_LLM_PROVIDER: "gemini", GEMINI_API_KEY: GEMINI_KEY }));
  assert.throws(() => loadConfig({ ZENO_LLM_PROVIDER: "gemini", ANTHROPIC_API_KEY: CLAUDE_KEY }), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    assert.deepEqual(error.problems, ["GEMINI_API_KEY is required (set it in .env)"]);
    return true;
  });
});

test("reads overrides from the environment", () => {
  const config = loadConfig({
    ANTHROPIC_API_KEY: CLAUDE_KEY,
    ZENO_LLM_MODEL: "some-model",
    ZENO_LLM_TIMEOUT_MS: "5000",
    ZENO_AUDIO_INPUT_DEVICE: ":1",
    ZENO_AUDIO_SAMPLE_RATE: "48000",
    ZENO_STT_MODEL: "models/other.bin",
    ZENO_TTS_VOICE: "bf_emma",
    ZENO_TTS_DTYPE: "fp32",
    ZENO_LOG_LEVEL: "debug",
  });
  assert.deepEqual(config.tts, { voice: "bf_emma", dtype: "fp32" });
  assert.equal(config.llm.model, "some-model");
  assert.equal(config.llm.timeoutMs, 5000);
  assert.equal(config.audio.inputDevice, ":1");
  assert.equal(config.audio.sampleRate, 48000);
  assert.equal(config.stt.modelPath, "models/other.bin");
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
        ZENO_LLM_PROVIDER: "openai",
        ZENO_LLM_TIMEOUT_MS: "soon",
        ZENO_AUDIO_SAMPLE_RATE: "-1",
        ZENO_LOG_LEVEL: "loud",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.problems.length, 5);
      assert.match(error.message, /ZENO_LLM_PROVIDER must be one of claude, gemini, got "openai"/);
      assert.match(error.message, /ANTHROPIC_API_KEY is required/);
      assert.match(error.message, /ZENO_LLM_TIMEOUT_MS must be a positive integer, got "soon"/);
      assert.match(error.message, /ZENO_AUDIO_SAMPLE_RATE must be a positive integer, got "-1"/);
      assert.match(error.message, /ZENO_LOG_LEVEL must be one of debug, info, warn, error, got "loud"/);
      return true;
    },
  );
});

test("never includes API keys in error messages", () => {
  assert.throws(
    () => loadConfig({ ANTHROPIC_API_KEY: CLAUDE_KEY, GEMINI_API_KEY: GEMINI_KEY, ZENO_LOG_LEVEL: "loud" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.ok(!error.message.includes(CLAUDE_KEY) && !error.message.includes(GEMINI_KEY));
      return true;
    },
  );
});
