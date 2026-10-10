import { test } from "node:test";
import assert from "node:assert/strict";
import type { TierChoice } from "@zeno/decision-engine";
import { HELPERS, chooseJobModel, modelForTier, resolveModel, tieredModels, type PlanModel } from "./index.ts";

// The Claude plan's table (packages/shared PROVIDERS), newest first, plus an unknown model.
const OFFERED = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  { id: "some-other-model", name: "Other" },
];
const MODELS = tieredModels(OFFERED);
const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-4-5-20251001";
const laya = (tier: TierChoice["tier"], label: TierChoice["label"], score: number): TierChoice => ({ tier, label, score, source: "laya" });
const FALLBACK: TierChoice = { tier: "medium", source: "fallback" };

test("the roster gives each helper a role, so floors are data", () => {
  assert.deepEqual(HELPERS.map((h) => [h.id, h.role]), [["sid", "researcher"], ["kame", "coder"], ["puff", "designer"]]);
});

test("tieredModels keeps Haiku, Sonnet and Opus with their tiers, in order; other models are left out", () => {
  assert.deepEqual(MODELS.map((m) => [m.id, m.tier]), [[OPUS, "large"], [SONNET, "medium"], ["claude-sonnet-5", "medium"], [HAIKU, "small"]]);
});

test("each tier gets the newest model of its family; a missing family falls to the next tier down", () => {
  assert.equal(modelForTier(MODELS, "large"), OPUS);
  assert.equal(modelForTier(MODELS, "medium"), SONNET, "the newest Sonnet, not Sonnet 5");
  assert.equal(modelForTier(MODELS, "small"), HAIKU);
  const noOpus = MODELS.filter((m) => m.tier !== "large");
  assert.equal(modelForTier(noOpus, "large"), SONNET);
  const onlyHaiku = MODELS.filter((m) => m.tier === "small");
  assert.equal(modelForTier(onlyHaiku, "large"), HAIKU);
  const onlyOpus = MODELS.filter((m) => m.tier === "large");
  assert.equal(modelForTier(onlyOpus, "small"), OPUS, "nothing lower: the only model there is");
  assert.equal(modelForTier([], "medium"), undefined);
});

test("Laya's tier picks the model, with the reason \"Laya: <rung>\"", () => {
  const base = { role: "researcher", allowLarge: true, models: MODELS };
  assert.deepEqual(resolveModel({ ...base, choice: laya("small", "trivial", 0.16) }), { model: HAIKU, tier: "small", score: 0.16, source: "laya", reason: "Laya: trivial" });
  assert.deepEqual(resolveModel({ ...base, choice: laya("medium", "moderate", 1.66) }), { model: SONNET, tier: "medium", score: 1.66, source: "laya", reason: "Laya: moderate" });
  assert.deepEqual(resolveModel({ ...base, choice: laya("large", "hard", 2.67) }), { model: OPUS, tier: "large", score: 2.67, source: "laya", reason: "Laya: hard" });
});

test("the coder, designer and financial adviser never go below medium: \"Role minimum\"", () => {
  for (const role of ["coder", "designer", "financial adviser"]) {
    const pick = resolveModel({ role, choice: laya("small", "trivial", 0.2), allowLarge: true, models: MODELS });
    assert.deepEqual([pick.model, pick.tier, pick.reason], [SONNET, "medium", "Role minimum"], role);
  }
  const researcher = resolveModel({ role: "researcher", choice: laya("small", "trivial", 0.2), allowLarge: true, models: MODELS });
  assert.equal(researcher.model, HAIKU, "the researcher has no floor");
  const coderHard = resolveModel({ role: "coder", choice: laya("large", "hard", 2.7), allowLarge: true, models: MODELS });
  assert.deepEqual([coderHard.model, coderHard.reason], [OPUS, "Laya: hard"], "a floor never lowers");
});

test("with the large model off, a large job is capped at medium: \"Large model off\"", () => {
  const pick = resolveModel({ role: "coder", choice: laya("large", "hard", 2.67), allowLarge: false, models: MODELS });
  assert.deepEqual([pick.model, pick.tier, pick.reason], [SONNET, "medium", "Large model off"]);
  const small = resolveModel({ role: "researcher", choice: laya("small", "trivial", 0.1), allowLarge: false, models: MODELS });
  assert.deepEqual([small.model, small.reason], [HAIKU, "Laya: trivial"], "the cap only touches large");
});

test("when Laya cannot answer, the role's default tier: \"Laya unavailable\"", () => {
  assert.deepEqual(resolveModel({ role: "researcher", choice: FALLBACK, allowLarge: true, models: MODELS }), {
    model: SONNET,
    tier: "medium",
    source: "fallback",
    reason: "Laya unavailable",
  });
  assert.equal(resolveModel({ role: "coder", choice: FALLBACK, allowLarge: false, models: MODELS }).reason, "Laya unavailable");
});

test("a pin skips Laya entirely and wins over floors and the cap; a pin no longer offered is ignored", async () => {
  let asked = 0;
  const engine = {
    chooseTier: async () => {
      asked += 1;
      return laya("small", "trivial", 0.1);
    },
  };
  const pinned = await chooseJobModel({ engine, task: "t", role: "researcher", pinnedModel: OPUS, allowLarge: false, models: MODELS });
  assert.deepEqual(pinned, { model: OPUS, tier: "large", source: "pinned", reason: "Pinned" });
  assert.equal(asked, 0);
  const stale = await chooseJobModel({ engine, task: "t", role: "researcher", pinnedModel: "claude-gone-1", allowLarge: true, models: MODELS });
  assert.deepEqual([stale.model, stale.reason], [HAIKU, "Laya: trivial"]);
  const none = await chooseJobModel({ engine, task: "t", role: "researcher", pinnedModel: null, allowLarge: true, models: MODELS });
  assert.equal(none.source, "laya");
  assert.equal(asked, 2);
});

test("no offered models (not the Claude plan): no model is picked", () => {
  const pick = resolveModel({ role: "researcher", choice: FALLBACK, allowLarge: true, models: [] as PlanModel[] });
  assert.equal(Object.hasOwn(pick, "model"), false);
});
