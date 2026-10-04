import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, findClaudeProgram, loadConfig, readProviderKeys } from "./config.ts";

// Placeholder values, not real credentials.
const CLAUDE_KEY = "test-claude-key-0000";
const GEMINI_KEY = "test-gemini-key-0000";

test("applies defaults when only the Anthropic key is set", () => {
  const config = loadConfig({ ANTHROPIC_API_KEY: CLAUDE_KEY });
  assert.deepEqual(config, {
    llm: { provider: "claude", apiKey: CLAUDE_KEY, model: "claude-sonnet-5", timeoutMs: 30_000 },
    audio: { inputDevice: ":default", sampleRate: 16_000 },
    stt: { modelPath: "models/ggml-small.en.bin", language: "en", vocabulary: "ZENO" },
    tts: { voice: "af_heart", dtype: "fp32" },
    log: { level: "info", file: "logs/zeno.log" },
  });
});

test("gemini uses its own key and default model", () => {
  const config = loadConfig({ ZENO_LLM_PROVIDER: "gemini", GEMINI_API_KEY: GEMINI_KEY, ANTHROPIC_API_KEY: CLAUDE_KEY });
  assert.deepEqual(config.llm, { provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-3.6-flash", timeoutMs: 30_000 });
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
      assert.match(error.message, /ZENO_LLM_PROVIDER must be one of claude, claude-plan, gemini, got "openai"/);
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

test("reads the key of every provider present, ignoring blank ones", () => {
  const noClaudeProgram = () => undefined;
  assert.deepEqual(readProviderKeys({ ANTHROPIC_API_KEY: ` ${CLAUDE_KEY} `, GEMINI_API_KEY: GEMINI_KEY }, noClaudeProgram), {
    claude: CLAUDE_KEY,
    gemini: GEMINI_KEY,
  });
  assert.deepEqual(readProviderKeys({ ANTHROPIC_API_KEY: "  " }, noClaudeProgram), {});
});

test("an explicit model choice overrides ZENO_LLM_PROVIDER / ZENO_LLM_MODEL and requires that provider's key", () => {
  const env = { ZENO_LLM_PROVIDER: "claude", ZENO_LLM_MODEL: "claude-sonnet-5", ANTHROPIC_API_KEY: CLAUDE_KEY, GEMINI_API_KEY: GEMINI_KEY };
  const config = loadConfig(env, { llm: { provider: "gemini", model: "gemini-3.8-flash" } });
  assert.deepEqual(config.llm, { provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-3.8-flash", timeoutMs: 30_000 });
  assert.throws(() => loadConfig({ ANTHROPIC_API_KEY: CLAUDE_KEY }, { llm: { provider: "gemini", model: "gemini-3.8-flash" } }), /GEMINI_API_KEY is required/);
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
  assert.equal(keys.claude, undefined);
  assert.equal(readProviderKeys({ ZENO_CLAUDE_PATH: "/definitely/not/here" })["claude-plan"], undefined);
});

test("choosing claude-plan needs no API key", () => {
  const config = loadConfig({}, { llm: { provider: "claude-plan", model: "claude-sonnet-5-5" } });
  assert.equal(config.llm.provider, "claude-plan");
  assert.equal(config.llm.model, "claude-sonnet-5-5");
  assert.doesNotThrow(() => loadConfig({ ZENO_LLM_PROVIDER: "claude-plan" }));
  assert.equal(loadConfig({ ZENO_LLM_PROVIDER: "claude-plan", ANTHROPIC_API_KEY: "sk-ant-nope-nope-nope" }).llm.apiKey.includes("sk-ant"), false, "the API key is never used for the plan provider");
});
