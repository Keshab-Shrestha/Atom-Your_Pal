import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, findClaudeProgram, loadConfig, readProviderKeys } from "./config.ts";

// Placeholder values, not real credentials.
const CLAUDE_KEY = "test-claude-key-0000";
const GEMINI_KEY = "test-gemini-key-0000";
const NO_CLAUDE = { ZENO_CLAUDE_PATH: "/definitely/not/here" };

test("defaults: Claude on the plan, with the claude program in the key slot (empty when it is not found)", () => {
  const config = loadConfig(NO_CLAUDE);
  assert.deepEqual(config, {
    llm: { provider: "claude-plan", apiKey: "", model: "claude-sonnet-5-5", timeoutMs: 30_000 },
    audio: { inputDevice: ":default", sampleRate: 16_000 },
    stt: { modelPath: "models/ggml-small.en.bin", language: "en", vocabulary: "ZENO" },
    tts: { voice: "af_heart", dtype: "fp32" },
    log: { level: "info", file: "logs/zeno.log" },
  });
  assert.equal(loadConfig({ ZENO_CLAUDE_PATH: process.execPath }).llm.apiKey, process.execPath);
});

test("reads overrides from the environment", () => {
  const config = loadConfig({
    ...NO_CLAUDE,
    ZENO_LLM_MODEL: "claude-opus-5-5",
    ZENO_LLM_TIMEOUT_MS: "5000",
    ZENO_AUDIO_INPUT_DEVICE: ":1",
    ZENO_AUDIO_SAMPLE_RATE: "48000",
    ZENO_STT_MODEL: "models/other.bin",
    ZENO_TTS_VOICE: "bf_emma",
    ZENO_TTS_DTYPE: "fp32",
    ZENO_LOG_LEVEL: "debug",
  });
  assert.deepEqual(config.tts, { voice: "bf_emma", dtype: "fp32" });
  assert.equal(config.llm.model, "claude-opus-5-5");
  assert.equal(config.llm.timeoutMs, 5000);
  assert.equal(config.audio.inputDevice, ":1");
  assert.equal(config.audio.sampleRate, 48000);
  assert.equal(config.stt.modelPath, "models/other.bin");
  assert.equal(config.log.level, "debug");
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
      assert.equal(error.problems.length, 4);
      assert.match(error.message, /ZENO_LLM_PROVIDER must be one of claude-plan, got "openai"/);
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

test("ADR-092: API keys in .env are not providers; Gemini and the Claude API settings run on the plan", () => {
  assert.deepEqual(readProviderKeys({ ANTHROPIC_API_KEY: "x", GEMINI_API_KEY: "y" }, () => undefined), {});
  for (const provider of ["gemini", "claude"]) {
    const config = loadConfig({ ZENO_LLM_PROVIDER: provider, ZENO_LLM_MODEL: "gemini-3.6-flash", ANTHROPIC_API_KEY: "sk-ant-nope-nope-nope" });
    assert.deepEqual([config.llm.provider, config.llm.model], ["claude-plan", "claude-sonnet-5-5"]);
    assert.ok(!config.llm.apiKey.includes("sk-ant"));
  }
  assert.throws(() => loadConfig({ ZENO_LLM_PROVIDER: "openai" }), /ZENO_LLM_PROVIDER must be one of claude-plan/);
});

// ---- Claude on the user's plan: no key, the signed-in `claude` program instead


test("the claude program is found from ZENO_CLAUDE_PATH first, then the usual places, then PATH", () => {
  const has = (...paths: string[]) => (p: string) => paths.includes(p);
  assert.equal(findClaudeProgram({ ZENO_CLAUDE_PATH: "/x/claude" }, has("/x/claude", "/h/.local/bin/claude"), "/h"), "/x/claude");
  assert.equal(findClaudeProgram({}, has("/h/.local/bin/claude", "/opt/homebrew/bin/claude"), "/h"), "/h/.local/bin/claude");
  assert.equal(findClaudeProgram({}, has("/opt/homebrew/bin/claude"), "/h"), "/opt/homebrew/bin/claude");
  assert.equal(findClaudeProgram({ PATH: "/a:/b" }, has("/b/claude"), "/h"), "/b/claude");
  assert.equal(findClaudeProgram({}, has(), "/h"), undefined);
  assert.equal(findClaudeProgram({ ZENO_CLAUDE_PATH: "/gone/claude" }, has("/h/.local/bin/claude"), "/h"), undefined, "a wrong explicit path is not silently replaced");
});

test("claude-plan counts as available when the program exists, with the path in its key slot", () => {
  const keys = readProviderKeys({ ZENO_CLAUDE_PATH: process.execPath });
  assert.equal(keys["claude-plan"], process.execPath);
  assert.equal(readProviderKeys({ ZENO_CLAUDE_PATH: "/definitely/not/here" })["claude-plan"], undefined);
});

test("choosing claude-plan needs no API key", () => {
  const config = loadConfig({}, { llm: { provider: "claude-plan", model: "claude-sonnet-5-5" } });
  assert.equal(config.llm.provider, "claude-plan");
  assert.equal(config.llm.model, "claude-sonnet-5-5");
  assert.doesNotThrow(() => loadConfig({ ZENO_LLM_PROVIDER: "claude-plan" }));
  assert.equal(loadConfig({ ZENO_LLM_PROVIDER: "claude-plan", ANTHROPIC_API_KEY: "sk-ant-nope-nope-nope" }).llm.apiKey.includes("sk-ant"), false, "the API key is never used for the plan provider");
});
