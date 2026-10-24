import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntries, filterEntries, isValidModelId, modelName, reasoningTitle, entryKey, type ProviderInfo } from "./models.ts";

const providers: ProviderInfo[] = [
  { id: "claude-plan", name: "Claude (my plan)", available: true, models: [{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" }, { id: "shared", name: "Shared" }] },
  { id: "codex", name: "Codex", available: true, models: [{ id: "codex-default", name: "Codex default" }, { id: "shared", name: "Shared" }] },
  { id: "gemini-cli", name: "Gemini CLI", available: false, models: [{ id: "gemini-default", name: "Gemini default" }] },
];

test("providers keep their order and equal model ids under different providers stay separate", () => {
  const entries = buildEntries(providers, "claude-plan", "claude-sonnet-5-5");
  assert.deepEqual(entries.map(entryKey), ["claude-plan/claude-sonnet-5-5", "claude-plan/shared", "codex/codex-default", "codex/shared", "gemini-cli/gemini-default"]);
  assert.equal(entries.find((e) => e.provider === "gemini-cli")!.available, false);
});

test("the model in use is listed even when its catalog lacks it (a custom model), only under its own provider", () => {
  const entries = buildEntries(providers, "codex", "my-custom:1");
  assert.ok(entries.some((e) => entryKey(e) === "codex/my-custom:1"));
  assert.ok(!entries.some((e) => entryKey(e) === "claude-plan/my-custom:1"));
});

test("a duplicate identity is listed once", () => {
  const dup: ProviderInfo[] = [{ id: "p", name: "P", available: true, models: [{ id: "m", name: "M" }, { id: "m", name: "M again" }] }];
  assert.equal(buildEntries(dup, "p", "m").length, 1);
});

test("search needs every word, ignores case and accents, and can be limited to one provider", () => {
  const entries = buildEntries(providers, "claude-plan", "claude-sonnet-5-5");
  assert.deepEqual(filterEntries(entries, "sonnet 5.5", undefined).map(entryKey), ["claude-plan/claude-sonnet-5-5"]);
  assert.deepEqual(filterEntries(entries, "CODEX", undefined).map((e) => e.provider), ["codex", "codex"]);
  assert.deepEqual(filterEntries(entries, "shared", "codex").map(entryKey), ["codex/shared"]);
  assert.equal(filterEntries(entries, "nothing like it", undefined).length, 0);
  assert.equal(filterEntries(buildEntries([{ id: "p", name: "Café", available: true, models: [{ id: "m", name: "M" }] }], "p", "m"), "cafe", undefined).length, 1);
});

test("a custom model id is 1 to 100 of letters, digits, dot, underscore, colon, hyphen", () => {
  for (const ok of ["gpt-5.5", "a", "org:model_v2", "x".repeat(100)]) assert.equal(isValidModelId(ok), true, ok);
  for (const bad of ["", "x".repeat(101), "has space", "new\nline", "a/b", "ünï", "model\n"]) assert.equal(isValidModelId(bad), false, JSON.stringify(bad));
});

test("a model shows its catalog name, else its id; thinking levels have readable titles", () => {
  assert.equal(modelName(providers, "claude-plan", "claude-sonnet-5-5"), "Claude Sonnet 5.5");
  assert.equal(modelName(providers, "claude-plan", "mystery"), "mystery");
  assert.deepEqual(["off", "none", "xhigh", "medium"].map(reasoningTitle), ["Off", "Off", "Extra high", "Medium"]);
});
