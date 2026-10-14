import { test } from "node:test";
import assert from "node:assert/strict";
import { HANDOFF_SUMMARY_CHARS, blockedPortions, isComplete, parseWorkPlan, planTable, portionContext, readyPortions, type PlanMember } from "./work-plan.ts";

// ADR-111: the work plan: checked in code, started in order, briefed with summaries only.

const members: PlanMember[] = [
  { id: "sid", name: "Sid", available: true, role: "researcher" },
  { id: "penny", name: "Penny", available: true, role: "financial adviser" },
  { id: "kame", name: "Kame", available: false, role: "coder" },
  { id: "tinker", name: "Tinker", available: true, role: "improver" },
];
const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;
const plan = () =>
  parseWorkPlan(
    { goal: "Compare mesh Wi-Fi kits for a flat", portions: [{ agent: "Sid", task: "Find three kits" }, { agent: "penny", task: "Price them", after: [1] }, { agent: "Sid", task: "Write the advice", after: [1, 2] }] },
    members,
  );

test("a plan names agents by name or id, keeps the order, and sorts and dedupes `after`", () => {
  const p = parseWorkPlan({ goal: "g", portions: [{ agent: "SID", task: "a" }, { agent: "sid", task: "b" }, { agent: "penny", task: "c", after: [2, 1, 1] }] }, members);
  assert.deepEqual(p.portions.map((x) => [x.n, x.agent, x.after]), [[1, "sid", []], [2, "sid", []], [3, "penny", [1, 2]]]);
});

test("a bad plan is refused with words the model can act on", () => {
  const bad = (input: Parameters<typeof parseWorkPlan>[0], re: RegExp) => assert.throws(() => parseWorkPlan(input, members), re);
  bad({ portions: [{ agent: "sid", task: "a" }] }, /needs a goal/);
  bad({ goal: "g", portions: [] }, /1 to 6 portions/);
  bad({ goal: "g", portions: "x" }, /1 to 6 portions/);
  bad({ goal: "g", portions: Array.from({ length: 7 }, () => ({ agent: "sid", task: "a" })) }, /at most 6/);
  bad({ goal: "g", portions: [{ agent: "Bob", task: "a" }] }, /Portion 1: there is no agent called "Bob"\. The agents: Sid, Penny\./);
  bad({ goal: "g", portions: [{ agent: "kame", task: "a" }] }, /Kame takes no portion/);
  bad({ goal: "g", portions: [{ agent: "tinker", task: "a" }] }, /Tinker takes no portion/);
  bad({ goal: "g", portions: [{ agent: "sid", task: "  " }] }, /task is empty/);
  bad({ goal: "g", portions: [{ agent: "sid", task: "x".repeat(5000) }] }, /too long/);
  bad({ goal: "g", portions: [{ agent: "sid", task: "a", after: [1] }] }, /only wait for portions before it, not 1/);
  bad({ goal: "g", portions: [{ agent: "sid", task: "a" }, { agent: "sid", task: "b", after: [3] }] }, /not 3/);
  bad({ goal: "g", portions: [{ agent: "sid", task: "a" }, { agent: "sid", task: "b", after: ["x"] }] }, /not NaN/);
  bad({ goal: "g", portions: [{ agent: "sid", task: "a" }, { agent: "sid", task: "b", after: 1 as never }] }, /list of earlier portion numbers/);
});

test("portions start in order: only those whose earlier portions are done, and each only once", () => {
  const p = plan();
  assert.deepEqual(readyPortions(p, new Set(), new Set()), [1]);
  assert.deepEqual(readyPortions(p, new Set(), new Set([1])), [], "1 runs, 2 and 3 wait");
  assert.deepEqual(readyPortions(p, new Set([1]), new Set([1])), [2]);
  assert.deepEqual(readyPortions(p, new Set([1, 2]), new Set([1, 2])), [3]);
  assert.equal(isComplete(p, new Set([1, 2])), false);
  assert.equal(isComplete(p, new Set([1, 2, 3])), true);
});

test("a failed portion blocks everything that waits for it, down the chain, and nothing else", () => {
  const p = parseWorkPlan({ goal: "g", portions: [{ agent: "sid", task: "a" }, { agent: "sid", task: "b" }, { agent: "penny", task: "c", after: [1] }, { agent: "penny", task: "d", after: [3] }] }, members);
  assert.deepEqual(blockedPortions(p, new Set([1])), [3, 4]);
  assert.deepEqual(blockedPortions(p, new Set([2])), []);
});

test("a brief carries the goal and the summaries of the portions it waited for, cut short, and no bodies", () => {
  const p = plan();
  const long = "A".repeat(500);
  const results = [{ n: 1, agent: "sid", title: "Three kits", summary: long }, { n: 2, agent: "penny", title: "Prices", summary: "Eero 200, Orbi 350." }];
  const text = portionContext(p, p.portions[2]!, results, nameOf);
  assert.match(text, /^Goal of the whole job: Compare mesh Wi-Fi kits for a flat\n/);
  assert.match(text, /- Portion 1, Sid: Three kits\. A+…/);
  assert.match(text, /- Portion 2, Penny: Prices\. Eero 200, Orbi 350\./);
  assert.match(text, /end with at most 80 words/);
  assert.ok(text.length < 600, `the brief stays small (${text.length} characters)`);
  assert.ok(!text.includes("A".repeat(HANDOFF_SUMMARY_CHARS + 1)), "the summary is cut");
  // A portion that waits for nothing gets no earlier-portions block.
  assert.ok(!portionContext(p, p.portions[0]!, results, nameOf).includes("Earlier portions"));
  // A result that is missing (not done) leaves its line out rather than inventing one.
  assert.ok(!portionContext(p, p.portions[1]!, [], nameOf).includes("Portion 1"));
});

test("the plan reads back as one short line a portion", () => {
  assert.equal(planTable(plan(), nameOf), "Plan: Compare mesh Wi-Fi kits for a flat\n1. Sid: Find three kits\n2. Penny (after 1): Price them\n3. Sid (after 1, 2): Write the advice");
});
