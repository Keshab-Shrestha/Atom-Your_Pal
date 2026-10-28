import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptedComputerPlan, readComputerChoice } from "./computer.ts";
import { createLayaEngine } from "./laya.ts";
const criteria = { plan_0: "Do A", plan_1: "Do B", review: "Return to main model" };
const raw = (overrides = {}) => ({ answers: { plan: { type: "choice", choice: "plan_0", probabilities: { plan_0: 1, plan_1: 0, review: 0 }, ...overrides } } });
test("choice parsing validates identity, distribution and confidence instead of trusting a model label", () => {
  assert.deepEqual(readComputerChoice(raw(), criteria), { choice: "plan_0", confidence: 1, probability: 1 });
  for (const change of [{ choice: "buy" }, { type: "noul" }, { confidence: NaN }, { confidence: 2 }, { probabilities: { plan_0: 1 } }, { probabilities: { plan_0: 1, plan_1: 1, review: 0 } }, { probabilities: { plan_0: -1, plan_1: 2, review: 0 } }, { probabilities: { plan_0: 0.1, plan_1: 0.9, review: 0 } }]) assert.equal(readComputerChoice(raw(change), criteria), undefined);
  assert.equal(acceptedComputerPlan(readComputerChoice(raw({ confidence: 0.9 }), criteria), 2), undefined);
  assert.equal(acceptedComputerPlan({ choice: "plan_0", confidence: NaN, probability: 1 }, 2), undefined);
  assert.equal(acceptedComputerPlan({ choice: "plan_3", confidence: 1, probability: 1 }, 2), undefined);
  assert.equal(acceptedComputerPlan({ choice: "review", confidence: 1, probability: 1 }, 2), undefined);
  assert.equal(acceptedComputerPlan(readComputerChoice(raw(), criteria), 2), 0);
});
test("Laya reuses its session for bounded computer choices without changing worker tier routing", async () => {
  let starts = 0, stopped = false;
  const engine = createLayaEngine({ connect: async () => { starts++; return { predict: async (_state, questions) => ({ content: [{ text: JSON.stringify("plan" in questions ? raw() : { answers: { difficulty: { score: 2 } } }) }] }), close: async () => { stopped = true; } }; } });
  assert.equal((await engine.chooseTier("ordinary task", "researcher")).source, "laya");
  assert.equal((await engine.chooseComputerPlan!({ state: "fictional", criteria }))?.choice, "plan_0");
  assert.equal(starts, 1);
  await engine.close(); assert.equal(stopped, true);
  assert.equal(await engine.chooseComputerPlan!({ state: "fictional", criteria }), undefined);
});
test("computer decision cancellation returns without waiting for a hung local model", async () => {
  const engine = createLayaEngine({ connect: async () => ({ predict: async () => new Promise(() => {}), close: async () => {} }) });
  const signal = new AbortController();
  const pending = engine.chooseComputerPlan!({ state: "fictional", criteria }, signal.signal);
  signal.abort();
  assert.equal(await pending, undefined);
  await engine.close();
});

test("explicit computer warm-up is local fictional input, deduplicated, and respects the off switch", async () => {
  const requests: unknown[] = [];
  let starts = 0;
  const connect = async () => { starts++; return { predict: async (state: unknown) => { requests.push(state); return {}; }, close: async () => {} }; };
  const disabled = createLayaEngine({ env: { ATOM_LAYA: "0" }, connect });
  disabled.warmComputer!(); await disabled.close(); assert.equal(starts, 0);
  const ready = createLayaEngine({ connect });
  ready.warmComputer!(); ready.warmComputer!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 1); assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { request: "Local computer decision readiness check. No action is requested." });
  await ready.close();
});
