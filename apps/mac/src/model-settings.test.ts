import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSwitchableModel, type SwitchableModel } from "@zeno/llm-gateway";
import { loadConfig, readProviderKeys, type LlmChoice } from "@zeno/shared";
import {
  DEFAULT_SETTINGS_PATH,
  createModelSettings,
  offeredModels,
  readSavedChoice,
  settingsPath,
  writeSavedChoice,
} from "./model-settings.ts";

// Placeholder values, not real credentials.
const CLAUDE_KEY = "test-claude-key-0000";
const GEMINI_KEY = "test-gemini-key-0000";
const BOTH = { claude: CLAUDE_KEY, gemini: GEMINI_KEY };

const tempDir = () => mkdtempSync(join(tmpdir(), "zeno-settings-"));
const noKeys = (text: string) => !text.includes(CLAUDE_KEY) && !text.includes(GEMINI_KEY);

type Model = Parameters<SwitchableModel["replace"]>[0];

function settingsHarness(over: { initial?: LlmChoice; keys?: typeof BOTH | { gemini: string }; save?: (c: LlmChoice) => void } = {}) {
  const built: { choice: LlmChoice; apiKey: string }[] = [];
  const saved: LlmChoice[] = [];
  const logs: string[] = [];
  const model = createSwitchableModel({ complete: async () => ({ text: "initial" }) });
  const settings = createModelSettings({
    initial: over.initial ?? { provider: "gemini", model: "gemini-3.6-flash" },
    keys: over.keys ?? BOTH,
    model,
    createModel: (choice, apiKey): Model => {
      built.push({ choice, apiKey });
      return { complete: async () => ({ text: `${choice.provider}/${choice.model}` }) };
    },
    save: over.save ?? ((choice) => saved.push(choice)),
    log: {
      info: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
      warn: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    },
  });
  return { settings, model, built, saved, logs };
}

const ask = (model: Model) =>
  model.complete({ system: "", messages: [], context: { requestId: "r", sessionId: "s", source: "voice", receivedAt: new Date(0) } });

test("info lists both providers, their availability and models, and never the keys", () => {
  const { settings } = settingsHarness({ keys: { gemini: GEMINI_KEY } });
  const info = settings.info();
  assert.equal(info.provider, "gemini");
  assert.equal(info.model, "gemini-3.6-flash");
  assert.deepEqual(
    info.providers.map((p) => [p.id, p.name, p.available, p.models.length]),
    [
      ["claude", "Claude", false, 4],
      ["gemini", "Gemini", true, 6],
    ],
  );
  assert.deepEqual(info.providers[0].models[0], { id: "claude-opus-5-5", name: "Claude Opus 5.5" });
  assert.ok(noKeys(JSON.stringify(settingsHarness().settings.info())));
});

test("the configured model is offered even when it is not in the table", () => {
  const custom = { provider: "gemini" as const, model: "gemini-experimental" };
  assert.deepEqual(offeredModels("gemini", custom).at(-1), { id: "gemini-experimental", name: "gemini-experimental" });
  assert.equal(offeredModels("claude", custom).length, 4);
  assert.equal(offeredModels("gemini", { provider: "gemini", model: "gemini-2.5-pro" }).length, 6); // no duplicate
  assert.deepEqual(offeredModels("openai", custom), []);

  const { settings } = settingsHarness({ initial: custom });
  assert.deepEqual(settings.setModel("gemini", "gemini-3.8-flash"), { ok: true });
  assert.deepEqual(settings.setModel("gemini", "gemini-experimental"), { ok: true }); // can switch back to it
});

test("a valid choice replaces the model, is saved and logged without keys", async () => {
  const h = settingsHarness();
  assert.deepEqual(h.settings.setModel("claude", "claude-opus-5-5"), { ok: true });
  assert.deepEqual(h.built, [{ choice: { provider: "claude", model: "claude-opus-5-5" }, apiKey: CLAUDE_KEY }]);
  assert.equal((await ask(h.model)).text, "claude/claude-opus-5-5");
  assert.deepEqual(h.saved, [{ provider: "claude", model: "claude-opus-5-5" }]);
  assert.deepEqual(h.settings.current(), { provider: "claude", model: "claude-opus-5-5" });
  assert.equal(h.settings.info().provider, "claude");
  assert.deepEqual(h.logs, [JSON.stringify({ event: "model.set", provider: "claude", model: "claude-opus-5-5" })]);
});

test("refused choices explain the fix and change nothing", async () => {
  const h = settingsHarness({ keys: { gemini: GEMINI_KEY } });
  const cases: [string, string, RegExp][] = [
    ["openai", "gpt-9", /Unknown AI provider "openai"\. Choose Claude or Gemini\./],
    ["claude", "claude-opus-5-5", /^Add ANTHROPIC_API_KEY to \.env to use Claude/],
    ["gemini", "gemini-9-ultra", /"gemini-9-ultra" is not a Gemini model ZENO offers/],
    ["gemini", "claude-opus-5-5", /not a Gemini model/],
    ["__proto__", "x", /Unknown AI provider/],
  ];
  for (const [provider, model, expected] of cases) {
    const result = h.settings.setModel(provider, model);
    assert.ok("error" in result, provider);
    assert.match(result.error, expected);
    assert.ok(noKeys(result.error));
  }
  assert.deepEqual(h.built, []);
  assert.deepEqual(h.saved, []);
  assert.deepEqual(h.settings.current(), { provider: "gemini", model: "gemini-3.6-flash" });
  assert.equal((await ask(h.model)).text, "initial");
});

test("a failed save still switches and is logged as a warning", () => {
  const h = settingsHarness({
    save: () => {
      throw new Error("EACCES: permission denied");
    },
  });
  assert.deepEqual(h.settings.setModel("gemini", "gemini-3.8-flash"), { ok: true });
  assert.equal(h.settings.current().model, "gemini-3.8-flash");
  assert.match(h.logs.at(-1) ?? "", /settings\.save_failed.*permission denied/);
});

test("writes the settings file atomically, creating its directory, without keys", () => {
  const dir = tempDir();
  const path = join(dir, "config", "island.json");
  writeSavedChoice(path, { provider: "claude", model: "claude-sonnet-5-5" });
  writeSavedChoice(path, { provider: "gemini", model: "gemini-3.7-flash" });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { llm: { provider: "gemini", model: "gemini-3.7-flash" } });
  assert.deepEqual(readdirSync(join(dir, "config")), ["island.json"]); // no temporary file left behind
  assert.ok(noKeys(readFileSync(path, "utf8")));
});

test("reads a saved choice back", () => {
  const path = join(tempDir(), "island.json");
  writeSavedChoice(path, { provider: "claude", model: "claude-haiku-4-5-20251001" });
  assert.deepEqual(readSavedChoice(path, BOTH), { choice: { provider: "claude", model: "claude-haiku-4-5-20251001" } });
});

test("a missing settings file is silent", () => {
  assert.deepEqual(readSavedChoice(join(tempDir(), "nope", "island.json"), BOTH), {});
});

test("an unusable settings file is ignored with a warning, never an exception", () => {
  const dir = tempDir();
  const cases: [string, RegExp][] = [
    ["{ not json", /not valid JSON/],
    ["[]", /expected \{"llm"/],
    ["null", /expected \{"llm"/],
    ['{"llm":{"provider":"gemini"}}', /expected \{"llm"/],
    ['{"llm":{"provider":"gemini","model":7}}', /expected \{"llm"/],
    ['{"llm":{"provider":"openai","model":"gpt-9"}}', /unknown provider "openai"/],
    ['{"llm":{"provider":"claude","model":"claude-opus-5-5"}}', /chooses Claude, but ANTHROPIC_API_KEY is not in \.env/],
  ];
  cases.forEach(([content, expected], i) => {
    const path = join(dir, `island-${i}.json`);
    writeFileSync(path, content);
    const result = readSavedChoice(path, { gemini: GEMINI_KEY });
    assert.equal(result.choice, undefined, content);
    assert.match(result.warning ?? "", expected, content);
    assert.ok(noKeys(result.warning ?? ""));
  });
});

test("at startup a valid saved choice overrides ZENO_LLM_PROVIDER / ZENO_LLM_MODEL", () => {
  const path = join(tempDir(), "island.json");
  writeSavedChoice(path, { provider: "claude", model: "claude-opus-5-5" });
  const env = { ZENO_LLM_PROVIDER: "gemini", ZENO_LLM_MODEL: "gemini-3.5-flash", GEMINI_API_KEY: GEMINI_KEY, ANTHROPIC_API_KEY: CLAUDE_KEY };
  const keys = readProviderKeys(env);
  assert.deepEqual(keys, BOTH);
  const config = loadConfig(env, { llm: readSavedChoice(path, keys).choice });
  assert.deepEqual(config.llm, { provider: "claude", apiKey: CLAUDE_KEY, model: "claude-opus-5-5", timeoutMs: 30_000 });
});

test("at startup an ignored settings file leaves the .env choice in place", () => {
  const dir = tempDir();
  const broken = join(dir, "broken.json");
  writeFileSync(broken, "{");
  const noKey = join(dir, "no-key.json");
  writeSavedChoice(noKey, { provider: "claude", model: "claude-opus-5-5" });
  const env = { ZENO_LLM_PROVIDER: "gemini", GEMINI_API_KEY: GEMINI_KEY };
  for (const path of [broken, noKey]) {
    const config = loadConfig(env, { llm: readSavedChoice(path, readProviderKeys(env)).choice });
    assert.deepEqual(config.llm, { provider: "gemini", apiKey: GEMINI_KEY, model: "gemini-3.6-flash", timeoutMs: 30_000 });
  }
});

test("the settings file location can be changed with ZENO_ISLAND_SETTINGS", () => {
  assert.equal(settingsPath({}), DEFAULT_SETTINGS_PATH);
  assert.equal(settingsPath({ ZENO_ISLAND_SETTINGS: " " }), "config/island.json");
  assert.equal(settingsPath({ ZENO_ISLAND_SETTINGS: "/tmp/x.json" }), "/tmp/x.json");
});
