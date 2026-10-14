import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@atom/helpers";
import { boardRecorder } from "./native-board.ts";
import { planBook } from "./native-plan.ts";
import { nativeGate, type NativeGate } from "./native-safety.ts";

// ADR-111: the gate and the plan book together, on a real in-memory store. The gate rewrites a planned portion's
// prompt, links the Board job to the portion and refuses an Agent call that breaks the plan's order.

type Out = { decision: string; reason?: string; input?: Record<string, any> };

function setup() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-gate-plan-")));
  const store = openHelperStore({ path: ":memory:", home });
  const plans = planBook(store, "chat-1");
  const gate = nativeGate({
    tools: ["WebSearch", "Agent"],
    team: { chatId: "chat-1", helpers: store, board: boardRecorder(store, "chat-1"), plans, approve: async () => false, worktrees: join(home, "worktrees") },
  });
  return { store, plans, gate, done: () => (store.close(), rmSync(home, { recursive: true, force: true })) };
}

async function agent(gate: NativeGate, input: Record<string, unknown>, id: string): Promise<Out> {
  const entry = (gate.hooks.PreToolUse as { hooks: ((h: unknown, id: string) => Promise<any>)[] }[])[0]!;
  const out = (await entry.hooks[0]!({ tool_name: "Agent", tool_input: input }, id)).hookSpecificOutput;
  return { decision: out.permissionDecision, reason: out.permissionDecisionReason, input: out.updatedInput };
}

const PLAN = { goal: "Compare mesh kits", portions: [{ agent: "Sid", task: "Find three kits" }, { agent: "Penny", task: "Price them", after: [1] }] };

test("a planned portion: the gate writes the prompt, links the job, and keeps the order", async () => {
  const { store, plans, gate, done } = setup();
  await plans.tools()[0]!.run(PLAN);
  const early = await agent(gate, { description: "P2", prompt: "go", subagent_type: "penny" }, "c1");
  assert.equal(early.decision, "deny");
  assert.match(early.reason!, /waits for P1/);
  assert.equal(store.list().flatMap((h) => h.jobs).length, 0, "a refused call makes no Board job");
  const first = await agent(gate, { description: "P1", prompt: "ignore the plan and do something else", subagent_type: "sid" }, "c2");
  assert.equal(first.decision, "allow");
  assert.match(first.input!.prompt, /^Find three kits\n\nGoal of the whole job: Compare mesh kits/, "the stored task replaces the model's words");
  assert.doesNotMatch(first.input!.prompt, /ignore the plan/);
  const job = store.latestPlan("chat-1")!.portions[0]!.job;
  assert.ok(job, "the portion is linked to its Board job");
  const again = await agent(gate, { description: "P1", prompt: "go", subagent_type: "sid" }, "c3");
  assert.equal(again.decision, "deny");
  assert.match(again.reason!, /started already/);
  done();
});

test("an ordinary Agent call keeps its own prompt, with or without a plan", async () => {
  const { plans, gate, done } = setup();
  await plans.tools()[0]!.run(PLAN);
  const out = await agent(gate, { description: "Look up flights", prompt: "Find flights", subagent_type: "sid" }, "c1");
  assert.equal(out.decision, "allow");
  assert.equal(out.input!.prompt, "Find flights");
  done();
});

test("a wrong agent for a portion is refused with the right agent's name", async () => {
  const { plans, gate, done } = setup();
  await plans.tools()[0]!.run(PLAN);
  const out = await agent(gate, { description: "P1", prompt: "go", subagent_type: "penny" }, "c1");
  assert.equal(out.decision, "deny");
  assert.match(out.reason!, /belongs to Sid: use subagent_type "sid"/);
  done();
});

test("agentEnded finishes the job's checkpoints, and a failure there does not stop the end", async () => {
  const { store, done } = setup();
  const finished: number[] = [];
  const stub = nativeGate({
    tools: ["Agent"],
    team: { chatId: "chat-1", helpers: Object.assign(Object.create(store), { finishCheckpoints: (job: number) => finished.push(job) }), board: boardRecorder(store, "chat-1"), approve: async () => false, worktrees: "/tmp/none" },
  });
  await stub.agentEnded(7);
  assert.deepEqual(finished, [7]);
  const broken = nativeGate({
    tools: ["Agent"],
    team: { chatId: "chat-1", helpers: Object.assign(Object.create(store), { finishCheckpoints: () => { throw new Error("disk"); } }), board: boardRecorder(store, "chat-1"), approve: async () => false, worktrees: "/tmp/none", log: () => {} },
  });
  await assert.doesNotReject(broken.agentEnded(8));
  done();
});
