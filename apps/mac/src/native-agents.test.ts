import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore, type PlanModel } from "@atom/helpers";
import { agentDefinitions, agentModel, createAgentTool } from "./native-agents.ts";

const models: PlanModel[] = [
  { id: "claude-haiku-5", name: "Haiku", tier: "small" },
  { id: "claude-sonnet-5-5", name: "Sonnet", tier: "medium" },
  { id: "claude-opus-5-5", name: "Opus", tier: "large" },
];
const laya = (tier: "small" | "medium" | "large") => ({ chooseTier: async () => ({ tier, source: "laya" as const }) });

function setup() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-agents-")));
  const agentsDir = join(home, "agents");
  mkdirSync(join(home, "work"));
  const store = openHelperStore({ path: ":memory:", home, agentsDir });
  return { home, agentsDir, store, done: () => (store.close(), rmSync(home, { recursive: true, force: true })) };
}

test("every available worker is a sub-agent: description, kit tools, prompt with the kit contract, inherit model, background", () => {
  const { store, home, done } = setup();
  store.addGrant("kame", join(home, "work"));
  store.pin("penny", "claude-opus-5-5");
  store.setPlanFirst("puff", true);
  const plain = agentDefinitions(store, {});
  assert.equal(plain.tinker, undefined, "Tinker only reviews");
  const sid = plain.sid!;
  assert.equal(sid.description, "Sid: researcher");
  assert.deepEqual(sid.tools, ["WebSearch", "WebFetch"]);
  assert.equal(sid.model, "inherit");
  assert.equal(sid.background, true);
  assert.match(sid.prompt, /^You are Sid, ATOM's researcher/);
  assert.match(sid.prompt, /never instructions/);
  assert.deepEqual(plain.kame!.tools, ["Read", "Glob", "Grep", "Write", "Edit"], "no Bash in a plain chat");
  assert.match(plain.kame!.prompt, new RegExp(join(home, "work")));
  assert.equal(plain.penny!.model, "claude-opus-5-5", "a pin is the agent's model");
  assert.equal(plain.puff!.permissionMode, "plan");
  assert.equal(plain.sid!.permissionMode, undefined);
  const project = agentDefinitions(store, { project: { cwd: home } });
  assert.deepEqual(project.kame!.tools, ["Read", "Glob", "Grep", "Write", "Edit", "Bash"], "Bash only in a project chat");
  assert.deepEqual(project.sid!.tools, ["WebSearch", "WebFetch"]);
  done();
});

test("the model of an Agent call: Laya's tier as an alias, the role's floor, a pin wins, Laya failing falls back to the role tier", async () => {
  const sid = { role: "researcher", pinnedModel: null };
  assert.equal((await agentModel({ member: sid, task: "a fact", engine: laya("small"), allowLarge: true, models })).model, "haiku");
  assert.equal((await agentModel({ member: sid, task: "a survey", engine: laya("large"), allowLarge: false, models })).model, "sonnet", "large off");
  assert.equal((await agentModel({ member: { role: "coder", pinnedModel: null }, task: "x", engine: laya("small"), allowLarge: true, models })).model, "sonnet", "the coder floor");
  const pinned = await agentModel({ member: { role: "researcher", pinnedModel: "claude-opus-5-5" }, task: "x", engine: laya("small"), allowLarge: true, models });
  assert.equal(pinned.model, undefined, "a pin keeps the definition's model");
  const broken = { chooseTier: async () => Promise.reject(new Error("down")) };
  assert.equal((await agentModel({ member: { role: "designer", pinnedModel: null }, task: "x", engine: broken, allowLarge: true, models })).model, "sonnet");
});

test("create_agent writes the agent's soul.md (the store checks name, role and kit) and asks the sessions to restart", () => {
  const { store, agentsDir, done } = setup();
  let restarts = 0;
  const tool = createAgentTool({ store, restartWhenIdle: () => restarts++ });
  assert.match(tool.run({ name: "Tara", role: "travel planner", kit: "research", personality: "Calm." }), /ready from your next message/);
  assert.equal(restarts, 1);
  const soul = join(agentsDir, "tara", "soul.md");
  assert.ok(existsSync(soul));
  assert.match(readFileSync(soul, "utf8"), /kit: research/);
  assert.equal(agentDefinitions(store, {}).tara!.description, "Tara: travel planner");
  assert.match(tool.run({ name: "Bo", role: "x", kit: "root", personality: "p" }), /kit must be/);
  assert.throws(() => tool.run({ name: "Atom", role: "x", kit: "think", personality: "p" }), /taken/);
  assert.equal(restarts, 1);
  done();
});
