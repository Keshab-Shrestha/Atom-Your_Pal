import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSwitchableModel, type SwitchableModel } from "@zeno/llm-gateway";
import { loadConfig, readProviderKeys, type LlmChoice, type ProviderKeys } from "@zeno/shared";
import {
  DEFAULT_SETTINGS_PATH,
  createModelSettings,
  offeredModels,
  readSavedChoice,
  settingsPath,
  writeSavedChoice,
} from "./model-settings.ts";

// ADR-092: ZENO runs on the user's own Claude plan; the "key" is the signed-in `claude` program's path (not secret, never sent).
const CLAUDE = "/Users/k/.local/bin/claude";
const PLAN: ProviderKeys = { "claude-plan": CLAUDE };

const tempDir = () => mkdtempSync(join(tmpdir(), "zeno-settings-"));
const noPath = (text: string) => !text.includes(CLAUDE);

type Model = Parameters<SwitchableModel["replace"]>[0];

function settingsHarness(over: { initial?: LlmChoice; keys?: ProviderKeys; save?: (c: LlmChoice) => void } = {}) {
  const built: { choice: LlmChoice; apiKey: string }[] = [];
  const saved: LlmChoice[] = [];
  const logs: string[] = [];
  const model = createSwitchableModel({ complete: async () => ({ text: "initial" }) });
  const settings = createModelSettings({
    initial: over.initial ?? { provider: "claude-plan", model: "claude-sonnet-5-5" },
    keys: over.keys ?? PLAN,
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

test("info offers only Claude on the plan, its models, and never the program's path", () => {
  const { settings } = settingsHarness();
  const info = settings.info();
  assert.deepEqual([info.provider, info.model], ["claude-plan", "claude-sonnet-5-5"]);
  assert.deepEqual(info.providers.map((p) => [p.id, p.name, p.available, p.models.length]), [["claude-plan", "Claude (my plan)", true, 3]]);
  assert.ok(noPath(JSON.stringify(info)));
  assert.equal(settingsHarness({ keys: {} }).settings.info().providers[0]!.available, false);
});

test("the configured model is offered even when it is not in the table", () => {
  const custom = { provider: "claude-plan" as const, model: "claude-experimental" };
  assert.deepEqual(offeredModels("claude-plan", custom).at(-1), { id: "claude-experimental", name: "claude-experimental" });
  assert.equal(offeredModels("claude-plan", { provider: "claude-plan", model: "claude-opus-5-5" }).length, 3); // no duplicate
  assert.deepEqual(offeredModels("gemini", custom), []);
  const { settings } = settingsHarness({ initial: custom });
  assert.deepEqual(settings.setModel("claude-plan", "claude-opus-5-5"), { ok: true });
  assert.deepEqual(settings.setModel("claude-plan", "claude-experimental"), { ok: true }); // can switch back to it
});

test("a valid choice replaces the model, is saved and logged without the path", async () => {
  const h = settingsHarness();
  assert.deepEqual(h.settings.setModel("claude-plan", "claude-opus-5-5"), { ok: true });
  assert.deepEqual(h.built, [{ choice: { provider: "claude-plan", model: "claude-opus-5-5" }, apiKey: CLAUDE }]);
  assert.equal((await ask(h.model)).text, "claude-plan/claude-opus-5-5");
  assert.deepEqual(h.saved, [{ provider: "claude-plan", model: "claude-opus-5-5" }]);
  assert.deepEqual(h.settings.current(), { provider: "claude-plan", model: "claude-opus-5-5" });
  assert.deepEqual(h.logs, [JSON.stringify({ event: "model.set", provider: "claude-plan", model: "claude-opus-5-5" })]);
});

test("refused choices explain the fix and change nothing; Gemini and the Claude API are gone (ADR-092)", async () => {
  const h = settingsHarness();
  const cases: [string, string, RegExp][] = [
    ["gemini", "gemini-3.6-flash", /Unknown AI provider "gemini"\. Choose Claude \(my plan\)\./],
    ["claude", "claude-opus-5-5", /Unknown AI provider "claude"/],
    ["claude-plan", "gpt-9", /"gpt-9" is not a Claude \(my plan\) model ZENO offers/],
    ["__proto__", "x", /Unknown AI provider/],
  ];
  for (const [provider, model, expected] of cases) {
    const result = h.settings.setModel(provider, model);
    assert.ok("error" in result, provider);
    assert.match(result.error, expected);
  }
  assert.deepEqual([h.built, h.saved], [[], []]);
  assert.equal((await ask(h.model)).text, "initial");
});

test("without the claude program it says to install it and sign in, not to add a key", () => {
  const h = settingsHarness({ keys: {} });
  const result = h.settings.setModel("claude-plan", "claude-sonnet-5-5");
  assert.ok("error" in result);
  assert.match(result.error, /claude auth login/);
  assert.doesNotMatch(result.error, /\.env/);
  assert.equal(h.built.length, 0);
});

test("a failed save still switches and is logged as a warning", () => {
  const h = settingsHarness({
    save: () => {
      throw new Error("EACCES: permission denied");
    },
  });
  assert.deepEqual(h.settings.setModel("claude-plan", "claude-haiku-4-5-20251001"), { ok: true });
  assert.equal(h.settings.current().model, "claude-haiku-4-5-20251001");
  assert.match(h.logs.at(-1) ?? "", /settings\.save_failed.*permission denied/);
});

test("writes the settings file atomically, creating its directory", () => {
  const dir = tempDir();
  const path = join(dir, "config", "island.json");
  writeSavedChoice(path, { provider: "claude-plan", model: "claude-sonnet-5-5" });
  writeSavedChoice(path, { provider: "claude-plan", model: "claude-opus-5-5" });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { llm: { provider: "claude-plan", model: "claude-opus-5-5" } });
  assert.deepEqual(readdirSync(join(dir, "config")), ["island.json"]); // no temporary file left behind
});

test("reads a saved choice back; a missing file is silent", () => {
  const path = join(tempDir(), "island.json");
  writeSavedChoice(path, { provider: "claude-plan", model: "claude-haiku-4-5-20251001" });
  assert.deepEqual(readSavedChoice(path, PLAN), { choice: { provider: "claude-plan", model: "claude-haiku-4-5-20251001" } });
  assert.deepEqual(readSavedChoice(join(tempDir(), "nope", "island.json"), PLAN), {});
});

test("an unusable settings file is ignored with a warning, never an exception", () => {
  const dir = tempDir();
  const cases: [string, ProviderKeys, RegExp][] = [
    ["{ not json", PLAN, /not valid JSON/],
    ["[]", PLAN, /expected \{"llm"/],
    ['{"llm":{"provider":"claude-plan"}}', PLAN, /expected \{"llm"/],
    ['{"llm":{"provider":"openai","model":"gpt-9"}}', PLAN, /unknown provider "openai"/],
    ['{"llm":{"provider":"gemini","model":"gemini-3.6-flash"}}', PLAN, /chooses gemini, which ZENO no longer uses/],
    ['{"llm":{"provider":"claude","model":"claude-opus-5-5"}}', PLAN, /chooses claude, which ZENO no longer uses/],
    ['{"llm":{"provider":"claude-plan","model":"claude-sonnet-5-5"}}', {}, /claude auth login/],
  ];
  cases.forEach(([content, keys, expected], i) => {
    const path = join(dir, `island-${i}.json`);
    writeFileSync(path, content);
    const result = readSavedChoice(path, keys);
    assert.equal(result.choice, undefined, content);
    assert.match(result.warning ?? "", expected, content);
  });
});

test("at startup an old .env naming Gemini or the Claude API still runs on the plan (ADR-092)", () => {
  const path = join(tempDir(), "island.json");
  writeSavedChoice(path, { provider: "claude-plan", model: "claude-opus-5-5" });
  const env = { ZENO_LLM_PROVIDER: "gemini", ZENO_LLM_MODEL: "gemini-3.5-flash", GEMINI_API_KEY: "test-key-0000", ZENO_CLAUDE_PATH: CLAUDE };
  const keys = readProviderKeys(env, () => CLAUDE);
  assert.deepEqual(keys, PLAN, "API keys in .env are not providers any more");
  assert.equal(loadConfig(env, { llm: readSavedChoice(path, keys).choice }).llm.model, "claude-opus-5-5");
  const plain = loadConfig(env);
  assert.deepEqual([plain.llm.provider, plain.llm.model], ["claude-plan", "claude-sonnet-5-5"], "a Gemini model is not used");
  assert.equal(loadConfig({ ZENO_LLM_PROVIDER: "claude", ZENO_LLM_MODEL: "claude-haiku-4-5-20251001" }).llm.model, "claude-haiku-4-5-20251001");
});

test("the settings file location can be changed with ZENO_ISLAND_SETTINGS", () => {
  assert.equal(settingsPath({}), DEFAULT_SETTINGS_PATH);
  assert.equal(settingsPath({ ZENO_ISLAND_SETTINGS: " " }), "config/island.json");
  assert.equal(settingsPath({ ZENO_ISLAND_SETTINGS: "/tmp/x.json" }), "/tmp/x.json");
});
