import { test } from "node:test";
import assert from "node:assert/strict";
import { FILE_TOOLS, runPlan, runResearch, runReview, type ResearchOptions } from "./claude-plan-job.ts";
import { MAX_SUB_AGENTS, subAgentsFor, type SubAgentEvent } from "./sub-agents.ts";
import type { ClaudeSdk } from "./claude-plan.ts";

// ADR-095: sub-agents inside a worker's run. The SDK is a script that calls canUseTool and the PreToolUse hook as
// Claude Code would (a sub-agent's own calls carry its agentID).
type Msg = Record<string, any>;
type Options = Record<string, any>;

const init: Msg = { type: "system", subtype: "init", apiKeySource: "none" };
const report = { title: "T", summary: "S.", body: "B.", sources: [] };
const done: Msg = { type: "result", subtype: "success", is_error: false, result: "", structured_output: report };
const signal = () => new AbortController().signal;

function fakeSdk(script: (options: Options) => AsyncIterable<Msg>) {
  const seen: Options[] = [];
  const sdk = { query: ({ options }: { options: Options }) => (seen.push(options), script(options)) } as unknown as ClaudeSdk;
  return { sdk, seen };
}

const base = (sdk: ClaudeSdk, over: Partial<ResearchOptions> = {}): ResearchOptions => ({
  claudePath: "/bin/claude",
  model: "claude-haiku-5",
  task: "Compare two laptops",
  instructions: "You are Sid.",
  signal: signal(),
  sdk,
  env: { PATH: "/bin" },
  ...over,
});

const launch = (o: Options, type: string, id: string, extra: Record<string, unknown> = {}) =>
  o.canUseTool("Agent", { description: `Find ${id}`, prompt: "Look it up", subagent_type: type, ...extra }, { signal: signal(), toolUseID: id });

const files = (checked: string[]): ResearchOptions["files"] => ({
  cwd: "/work",
  writable: ["/work"],
  denyRead: [],
  check: async (name) => (checked.push(name), undefined),
});

test("the agents option per kit: web → searcher and reader, folders → coder and checker, each a subset of the run's tools", async () => {
  const { sdk, seen } = fakeSdk(async function* () {
    yield init;
    yield done;
  });
  await runResearch(base(sdk));
  await runResearch(base(sdk, { files: files([]) }));
  await runResearch(base(sdk, { skills: { pluginDir: "/p", plugin: "atom-skills", names: ["pdf"] }, onSkill: () => {} }));
  const [web, folders, skilled] = seen as [Options, Options, Options];
  assert.deepEqual(Object.keys(web.agents), ["searcher", "reader"]);
  assert.deepEqual(Object.keys(folders.agents), ["coder", "checker"]);
  for (const o of [web, folders]) {
    for (const [name, a] of Object.entries(o.agents) as [string, Options][]) {
      assert.ok(a.tools.length > 0);
      assert.ok(a.tools.every((t: string) => o.tools.includes(t) && t !== "Agent"), "never more than the run itself");
      assert.equal(a.model, ({ searcher: "haiku", reader: "haiku", checker: "sonnet", coder: "inherit" } as Record<string, string>)[name], name); // ADR-098 item 9
      assert.equal(a.permissionMode, "default");
      assert.deepEqual(a.disallowedTools, ["Agent", "Task"]);
    }
    assert.equal(o.hooks.PreToolUse[0].matcher, "Agent|Task");
    assert.match(o.systemPrompt, new RegExp(`up to ${MAX_SUB_AGENTS} sub-agents`));
    // Nothing from the account, as for every run.
    assert.deepEqual([o.strictMcpConfig, o.settingSources, o.allowedTools], [true, [], []]);
  }
  assert.deepEqual(folders.agents.checker.tools, ["Read", "Glob", "Grep", "Bash"]);
  assert.deepEqual(skilled.agents.searcher.tools, ["WebSearch", "Skill"], "the worker's skills, through the same plugin");
  assert.equal(web.agents.searcher.tools.includes("Skill"), false);
});

test("no sub-agents for a think run, a plan, or Tinker's review; a subset never grows past its parent", async () => {
  const { sdk, seen } = fakeSdk(async function* () {
    yield init;
    yield done;
  });
  await runResearch(base(sdk, { thinkOnly: true }));
  // The plan's and review's shapes are wrong here; only their options matter.
  await assert.rejects(runPlan(base(sdk)));
  await assert.rejects(runReview(base(sdk)));
  for (const o of seen) {
    assert.deepEqual(o.tools, []);
    assert.equal(o.agents, undefined);
    assert.equal(o.hooks, undefined);
  }
  assert.equal(subAgentsFor([], true), undefined);
  assert.deepEqual(subAgentsFor(["WebSearch"], false)?.reader?.tools, [], "a tool the parent lacks is dropped");
  assert.deepEqual(subAgentsFor(FILE_TOOLS.filter((t) => t !== "Write"), false)?.coder?.tools, ["Read", "Edit", "Glob", "Grep", "Bash"]);
});

test("at most four sub-agents a run; only its own kinds, in the foreground, never from a sub-agent; the hook and canUseTool count once", async () => {
  const answers: Msg[] = [];
  const { sdk } = fakeSdk(async function* (o) {
    yield init;
    const hook = o.hooks.PreToolUse[0].hooks[0];
    const viaHook = await hook({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { description: "d", prompt: "p", subagent_type: "searcher", isolation: "remote", model: "opus" }, tool_use_id: "a1" }, "a1", { signal: signal() });
    answers.push(viaHook.hookSpecificOutput);
    answers.push(await launch(o, "searcher", "a1")); // the same call asked again: not counted twice
    answers.push(await launch(o, "general-purpose", "x1"));
    answers.push(await o.canUseTool("Agent", { subagent_type: "reader", prompt: "p", description: "d" }, { signal: signal(), toolUseID: "n1", agentID: "sub-1" }));
    for (const id of ["a2", "a3", "a4", "a5"]) answers.push(await launch(o, "reader", id));
    const fifth = await hook({ hook_event_name: "PreToolUse", tool_name: "Task", tool_input: { subagent_type: "reader" }, tool_use_id: "a6" }, "a6", { signal: signal() });
    answers.push(fifth.hookSpecificOutput);
    assert.deepEqual(await hook({ hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: {}, tool_use_id: "w" }, "w", { signal: signal() }), {});
    yield done;
  });
  const events: SubAgentEvent[] = [];
  await runResearch(base(sdk, { onSubAgent: (e) => events.push(e) }));
  const [hooked, again, unknown, nested, a2, a3, a4, a5, sixth] = answers as Msg[];
  assert.equal(hooked!.permissionDecision, "allow");
  assert.deepEqual(hooked!.updatedInput, { description: "d", prompt: "p", subagent_type: "searcher", run_in_background: false }, "no remote copy, no other model");
  assert.equal(again!.behavior, "allow");
  assert.equal(unknown!.behavior, "deny");
  assert.match(unknown!.message, /searcher or reader/);
  assert.deepEqual([nested!.behavior, nested!.message], ["deny", "A sub-agent cannot start sub-agents."]);
  assert.deepEqual([a2, a3, a4].map((a) => a!.behavior), ["allow", "allow", "allow"]);
  assert.equal(a5!.behavior, "deny");
  assert.match(a5!.message, /started 4 sub-agents, the most it may/);
  assert.equal(sixth!.permissionDecision, "deny");
  assert.deepEqual(events.filter((e) => e.state === "started").map((e) => e.id), ["a1", "a2", "a3", "a4"]);
});

test("a sub-agent's tool calls go through the same checks: the page limit, the folder check, and only its own tools", async () => {
  const answers: string[] = [];
  const { sdk } = fakeSdk(async function* (o) {
    yield init;
    await launch(o, "reader", "r1");
    const sub = { signal: signal(), toolUseID: "t", agentID: "sub-r1" };
    for (let i = 0; i < 3; i++) answers.push((await o.canUseTool("WebFetch", { url: "https://x" }, sub)).behavior);
    answers.push((await o.canUseTool("Bash", { command: "ls" }, sub)).behavior);
    answers.push((await o.canUseTool("mcp__atom__hand_off", { worker: "x", task: "y" }, sub)).behavior);
    answers.push((await o.canUseTool("SubagentHandback", { message: "done" }, sub)).behavior);
    answers.push((await o.canUseTool("WebFetch", { url: "https://x" }, { signal: signal(), toolUseID: "p" })).behavior); // the run's own: limit shared
    yield done;
  });
  const result = await runResearch(base(sdk, { pageLimit: 3 }));
  assert.deepEqual(answers, ["allow", "allow", "allow", "deny", "deny", "allow", "deny"]);
  assert.equal(result.pages, 3);

  const checked: string[] = [];
  const fileAnswers: string[] = [];
  const { sdk: fileSdk } = fakeSdk(async function* (o) {
    yield init;
    await launch(o, "checker", "c1");
    const sub = { signal: signal(), toolUseID: "t", agentID: "sub-c1" };
    fileAnswers.push((await o.canUseTool("Bash", { command: "npm test" }, sub)).behavior);
    fileAnswers.push((await o.canUseTool("Bash", { command: "ls", dangerouslyDisableSandbox: true }, sub)).behavior);
    fileAnswers.push((await o.canUseTool("WebSearch", { query: "q" }, sub)).behavior);
    yield done;
  });
  await runResearch(base(fileSdk, { files: files(checked) }));
  assert.deepEqual(fileAnswers, ["allow", "deny", "deny"]);
  assert.deepEqual(checked, ["Bash"], "the sub-agent's command went through the folder check; the sandbox switch is refused first");
});

test("the thread's record: started, then done with its own text or failed; one still open when the run ends failed", async () => {
  const { sdk } = fakeSdk(async function* (o) {
    yield init;
    await launch(o, "searcher", "s1", { description: "Find laptop reviews ".repeat(10) });
    await launch(o, "reader", "r1");
    await launch(o, "reader", "r2");
    yield { type: "assistant", parent_tool_use_id: "s1", message: { content: [{ type: "tool_use", id: "w", name: "WebSearch", input: {} }] } };
    yield { type: "user", parent_tool_use_id: "s1", message: { content: [{ type: "tool_result", tool_use_id: "w", content: "inside the sub-agent" }] } };
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_result", tool_use_id: "s1", content: [{ type: "text", text: "Three pages.\nagentId: x (usage...)" }] }] },
      tool_use_result: { agentId: "x", content: [{ type: "text", text: "Three   good pages." }] },
    };
    yield { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "r1", is_error: true, content: "x".repeat(300) }] } };
    yield { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "other", content: "not a sub-agent" }] } };
    yield done;
  });
  const events: SubAgentEvent[] = [];
  await runResearch(base(sdk, { onSubAgent: (e) => events.push(e) }));
  assert.deepEqual(events.map((e) => [e.id, e.name, e.state]), [
    ["s1", "searcher", "started"],
    ["r1", "reader", "started"],
    ["r2", "reader", "started"],
    ["s1", "searcher", "done"],
    ["r1", "reader", "failed"],
    ["r2", "reader", "failed"],
  ]);
  assert.equal(events[0]!.description!.length, 120);
  assert.equal(events[3]!.result, "Three good pages.", "Claude Code's own text, without its trailer");
  assert.equal(events[4]!.result!.length, 200);
  assert.equal(events[5]!.result, undefined);
});

test("a hook on every tool refuses a sub-agent's call to a tool not its own, even one Claude Code would auto-allow", async () => {
  const answers: Msg[] = [];
  const { sdk } = fakeSdk(async function* (o) {
    yield init;
    assert.equal(o.hooks.PreToolUse[1].matcher, undefined, "every tool");
    const hook = o.hooks.PreToolUse[1].hooks[0];
    const ask = async (tool_name: string, agent_id?: string) =>
      hook({ hook_event_name: "PreToolUse", tool_name, tool_input: {}, tool_use_id: "t", ...(agent_id ? { agent_id } : {}) }, "t", { signal: signal() });
    answers.push(await ask("TodoWrite", "sub-c1")); // no sub-agent has it (Claude Code may auto-allow it)
    answers.push(await ask("Read", "sub-c1")); // its own, read-only: left to Claude Code and canUseTool
    answers.push(await ask("SubagentHandback", "sub-c1"));
    answers.push(await ask("TodoWrite")); // the run's own call: not this hook's business
    yield done;
  });
  await runResearch(base(sdk, { files: files([]) }));
  const [write, read, handback, own] = answers as Msg[];
  assert.deepEqual([write!.hookSpecificOutput.permissionDecision, write!.hookSpecificOutput.permissionDecisionReason], ["deny", "A sub-agent may only use its own tools."]);
  assert.deepEqual([read, handback, own], [{}, {}, {}]);
});
