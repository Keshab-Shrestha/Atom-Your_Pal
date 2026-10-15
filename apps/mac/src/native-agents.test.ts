import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_AGENTS, RESERVED_AGENT_IDS, openHelperStore, type PlanModel } from "@atom/helpers";
import { BROWSER_SERVER } from "./browser.ts";
import { BUILT_IN_AGENTS, agentDefinitions, agentModel, createAgentTool, RESEARCH_PAGES, RESEARCH_SEARCHES } from "./native-agents.ts";

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

test("create_agent asks on the approval card, then writes the agent's soul.md (the store checks name, role and kit) and asks the sessions to restart", async () => {
  const { store, agentsDir, done } = setup();
  let restarts = 0;
  const asked: { summary: string; reason: string }[] = [];
  const tool = createAgentTool({ store, approve: async (r) => (asked.push(r), true), restartWhenIdle: () => restarts++ });
  assert.match(await tool.run({ name: "Tara", role: "travel planner", kit: "research", personality: "Calm." }), /ready from your next message/);
  assert.equal(asked[0]!.summary, "Make a new agent: Tara");
  assert.match(asked[0]!.reason, /^Role: travel planner\. Kit: research\.\nCalm\.$/);
  assert.equal(restarts, 1);
  const soul = join(agentsDir, "tara", "soul.md");
  assert.ok(existsSync(soul));
  assert.match(readFileSync(soul, "utf8"), /kit: research/);
  assert.equal(agentDefinitions(store, {}).tara!.description, "Tara: travel planner");
  assert.match(await tool.run({ name: "Bo", role: "x", kit: "root", personality: "p" }), /kit must be/);
  await assert.rejects(tool.run({ name: "Atom", role: "x", kit: "think", personality: "p" }), /taken/);
  assert.equal(restarts, 1);
  done();
});

test("create_agent: a declined card makes nothing; the soul preview is cut", async () => {
  const { store, agentsDir, done } = setup();
  const asked: string[] = [];
  const tool = createAgentTool({ store, approve: async (r) => (asked.push(r.reason), false), restartWhenIdle: () => assert.fail("no restart") });
  assert.match(await tool.run({ name: "Tara", role: "travel planner", kit: "research", personality: "p".repeat(600) }), /did not approve.*Nothing was made/);
  assert.ok(!existsSync(join(agentsDir, "tara")));
  assert.ok(!store.list().some((h) => h.id === "tara"));
  assert.ok(asked[0]!.length < 460, "about 400 characters of the soul");
  done();
});

test("create_agent refuses Claude Code's built-in agent names, a path in the name, and more than MAX_AGENTS agents", async () => {
  const { store, agentsDir, done } = setup();
  let cards = 0;
  const tool = createAgentTool({ store, approve: async () => (cards++, true), restartWhenIdle: () => {} });
  for (const name of ["Plan", "explore", "General-Purpose", "Statusline Setup", "Claude", "Fork"]) {
    assert.match(await tool.run({ name, role: "x", kit: "think", personality: "p" }), /Claude Code's own agents/, name);
  }
  assert.equal(cards, 0, "no card for a name that cannot be made");
  assert.throws(() => store.createAgent({ name: "Output Style Setup", role: "x", kit: "think", personality: "p" }), /Claude Code's own agents/, "the store refuses too");
  assert.deepEqual(BUILT_IN_AGENTS.map((a) => a.toLowerCase()), RESERVED_AGENT_IDS);
  await tool.run({ name: "Tara", role: "x", kit: "think", personality: "Calm." });
  const tara = readFileSync(join(agentsDir, "tara", "soul.md"), "utf8");
  const folders = readdirSync(agentsDir);
  await assert.rejects(tool.run({ name: "../tara", role: "x", kit: "folders", personality: "p" }), /letters only/);
  assert.equal(readFileSync(join(agentsDir, "tara", "soul.md"), "utf8"), tara, "no other soul is overwritten");
  assert.deepEqual(readdirSync(agentsDir), folders, "no new folder");
  const names = ["Ana", "Ben", "Cy", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kai", "Lu", "Mo", "Ned", "Oz", "Pia", "Quin", "Rex", "Sue", "Ty"];
  for (const name of names) {
    try {
      await tool.run({ name, role: "x", kit: "think", personality: "p" });
    } catch (error) {
      assert.match(String(error), new RegExp(`already ${MAX_AGENTS} agents`));
      break;
    }
  }
  await assert.rejects(tool.run({ name: "Zed", role: "x", kit: "think", personality: "p" }), new RegExp(`already ${MAX_AGENTS} agents`));
  done();
});

test("an agent with the browser or MCP servers gets ToolSearch (its tools are deferred); one without does not", () => {
  const { store, done } = setup();
  store.setBrowser("sid", true);
  const defs = agentDefinitions(store, { browser: () => ({ command: "npx" }) });
  assert.deepEqual(defs.sid!.tools, ["WebSearch", "WebFetch", `mcp__${BROWSER_SERVER}`, "ToolSearch"]);
  assert.ok(!defs.kame!.tools.includes("ToolSearch"));
  done();
});

// 2026-10-15: a research worker's web work has limits. Every page it fetches is read again by a small model and kept in its
// context; "read a few good pages" had no limit, and one request used 4 searches and 2 pages (about 24k tokens in all).
test("a research agent is told the most searches and pages it may use, and to use the search results first", () => {
  const sid = agentDefinitions(
    { list: () => [{ id: "sid", name: "Sid", role: "researcher", available: true, kit: "research", grants: [], skills: [], soul: { name: "Sid", personality: "Curious.", howItWorks: "", rules: "", lessons: [] }, pinnedModel: null, planFirst: false } as never], mcpServers: () => [] },
    {},
  ).sid!;
  assert.match(sid.prompt, new RegExp(`Search at most ${RESEARCH_SEARCHES} times and read at most ${RESEARCH_PAGES} pages, then stop and report`));
  assert.match(sid.prompt, /use them before you fetch a page/);
  assert.ok(RESEARCH_SEARCHES <= 3 && RESEARCH_PAGES <= 2, "the limits stay small");
  assert.doesNotMatch(sid.prompt, /a few good pages/);
});
