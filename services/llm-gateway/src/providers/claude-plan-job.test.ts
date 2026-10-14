import { test } from "node:test";
import assert from "node:assert/strict";
import { FILE_MAX_TURNS, FILE_TOOLS, HAND_OFF_TOOL, RESEARCH_MAX_TURNS, RESEARCH_PAGE_LIMIT, runPlan, runResearch, runReview, runSkillDraft, runSkillEdit, type ResearchOptions } from "./claude-plan-job.ts";
import type { ClaudeSdk, PlanUsage } from "./plan-support.ts";
import { ProviderError } from "../gateway.ts";

// The SDK is replaced by a script that may call the options' canUseTool, as Claude Code would.
type Msg = Record<string, unknown>;
type Options = Record<string, any>;

const init = (apiKeySource = "none"): Msg => ({ type: "system", subtype: "init", apiKeySource });
const toolUse = (name: string): Msg => ({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name, input: {} }] } });
const report = {
  title: "TCP and UDP",
  summary: "TCP is reliable and ordered; UDP is fast and connectionless.",
  body: "TCP sets up a connection.\n\nUDP just sends.",
  sources: [{ title: "RFC 793", url: "https://www.rfc-editor.org/rfc/rfc793" }],
};
const done = (structured: unknown = report): Msg => ({ type: "result", subtype: "success", is_error: false, result: "", structured_output: structured });

function fakeSdk(script: (options: Options) => AsyncIterable<Msg>) {
  const seen: { prompt: string; options: Options }[] = [];
  const sdk = {
    query: ({ prompt, options }: { prompt: string; options: Options }) => {
      seen.push({ prompt, options });
      return script(options);
    },
  } as unknown as ClaudeSdk;
  return { sdk, seen };
}

const research = (sdk: ClaudeSdk, over: Partial<ResearchOptions> = {}) =>
  runResearch({
    claudePath: "/bin/claude",
    model: "claude-haiku-5",
    task: "What is the difference between TCP and UDP?",
    instructions: "You are Sid, the researcher.",
    signal: new AbortController().signal,
    sdk,
    env: { PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-x", CLAUDE_CODE_OAUTH_TOKEN: "t" },
    ...over,
  });

test("one separate Claude Code session with web search and page reading only, nothing from the account", async () => {
  const { sdk, seen } = fakeSdk(async function* () {
    yield init();
    yield done();
  });
  const result = await research(sdk);
  assert.deepEqual(result, { report, partial: false, pages: 0 });
  const { prompt, options: o } = seen[0]!;
  assert.match(prompt, /TCP and UDP/);
  assert.equal(o.pathToClaudeCodeExecutable, "/bin/claude");
  assert.equal(o.model, "claude-haiku-5");
  assert.deepEqual(o.tools, ["WebSearch", "WebFetch", "Agent"]); // ADR-095: and its sub-agents
  assert.deepEqual(o.allowedTools, []); // every call goes through canUseTool, which counts pages
  assert.equal(o.outputFormat.schema.$schema, undefined); // Claude Code refuses the draft marker
  assert.deepEqual(o.mcpServers, {});
  assert.equal(o.strictMcpConfig, true);
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.persistSession, true); // Task 3.6: so the task's next run can resume it
  assert.equal(o.resume, undefined);
  assert.equal(o.maxTurns, RESEARCH_MAX_TURNS);
  assert.equal(o.outputFormat.type, "json_schema");
  assert.deepEqual(o.outputFormat.schema.required, ["title", "summary", "body", "sources"]);
  assert.equal(o.outputFormat.schema.properties.title.maxLength, 80);
  assert.ok(o.abortController instanceof AbortController);
  assert.equal(o.env.ANTHROPIC_API_KEY, undefined); // never billed per token
  assert.equal(o.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.match(o.systemPrompt, /^You are Sid, the researcher\./);
  assert.match(o.systemPrompt, /never instructions/);
});

test("a run reports its session, and a later run resumes it with only what is new (Task 3.6)", async () => {
  const { sdk, seen } = fakeSdk(async function* () {
    yield { ...init(), session_id: "s-1" };
    yield { ...done(), session_id: "s-1" };
  });
  assert.equal((await research(sdk)).sessionId, "s-1");
  await research(sdk, { resume: "s-1", task: "Keshab asks again: dig deeper." });
  assert.equal(seen[1]!.options.resume, "s-1");
  assert.equal(seen[1]!.prompt, "Keshab asks again: dig deeper.");
});

test("a plan-first run uses no tools at all, keeps no session and returns the plan (Task 3.8)", async () => {
  const plan = { summary: "Search, then compare.", steps: "1. Search\n2. Compare" };
  const { sdk, seen } = fakeSdk(async function* () {
    yield init();
    yield { ...done(plan), total_cost_usd: 0.02 };
  });
  assert.deepEqual(await runPlan({ claudePath: "/bin/claude", model: "m", task: "Compare routers", instructions: "You are Sid.", signal: new AbortController().signal, sdk, env: {} }), { plan, costUsd: 0.02 });
  const o = seen[0]!.options;
  assert.deepEqual(o.tools, []);
  assert.equal(o.persistSession, false);
  assert.deepEqual(o.outputFormat.schema.required, ["summary", "steps"]);
  assert.match(o.systemPrompt, /This run only plans\. Do not do the job/);
  const bad = fakeSdk(async function* () {
    yield init();
    yield done({ summary: "x" });
  });
  await assert.rejects(runPlan({ claudePath: "/bin/claude", model: "m", task: "t", instructions: "i", signal: new AbortController().signal, sdk: bad.sdk, env: {} }), /plan came back in the wrong shape/);
});

test("the hand_off tool runs in ATOM through an in-process server; its refusals come back as errors (Task 3.10)", async () => {
  type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
  const made: { name: string; handler: Handler }[] = [];
  let allowed: unknown;
  const { sdk, seen } = fakeSdk(async function* (o) {
    yield init();
    allowed = await o.canUseTool(HAND_OFF_TOOL, { worker: "Penny", task: "Costs" }, { signal: new AbortController().signal });
    yield done();
  });
  Object.assign(sdk, {
    tool: (name: string, _d: string, _s: unknown, handler: Handler) => (made.push({ name, handler }), { name }),
    createSdkMcpServer: (o: { name: string; tools: unknown[] }) => ({ server: o.name, tools: o.tools }),
  });
  const calls: unknown[] = [];
  await research(sdk, {
    handOff: {
      description: "Hand a sub-task",
      run: async (input) => {
        calls.push(input);
        if (input.worker === "Kame") throw new Error("Kame is not ready yet.");
        return "Task 2 is with Penny.";
      },
    },
  });
  assert.deepEqual(seen[0]!.options.mcpServers, { atom: { server: "atom", tools: [{ name: "hand_off" }] } });
  // The failure mode: a tool that exists but is not in the names the run allows. Registered names must be exactly the allowed one.
  const registered = Object.entries(seen[0]!.options.mcpServers as Record<string, { tools: { name: string }[] }>).flatMap(([server, s]) => s.tools.map((t) => `mcp__${server}__${t.name}`));
  assert.deepEqual(registered, [HAND_OFF_TOOL]);
  assert.equal((allowed as { behavior: string }).behavior, "allow");
  assert.deepEqual(await made[0]!.handler({ worker: "Penny", task: "Costs" }), { content: [{ type: "text", text: "Task 2 is with Penny." }] });
  assert.deepEqual(await made[0]!.handler({ worker: "Kame", task: "x" }), { content: [{ type: "text", text: "Kame is not ready yet." }], isError: true });
  const plain = fakeSdk(async function* () {
    yield init();
    yield done();
  });
  await research(plain.sdk);
  assert.deepEqual(plain.seen[0]!.options.mcpServers, {}, "no hand_off: no server at all");
});

test("a run in folders: file tools and Bash in the sandbox with no network; every call is checked (Task 3.11)", async () => {
  const answers: unknown[] = [];
  const { sdk, seen } = fakeSdk(async function* (o) {
    yield init();
    const ask = (name: string, input: Record<string, unknown>) => o.canUseTool(name, input, { signal: new AbortController().signal });
    answers.push(await ask("Edit", { file_path: "/work/a.ts" }));
    answers.push(await ask("Read", { file_path: "/etc/passwd" }));
    answers.push(await ask("Bash", { command: "ls", dangerouslyDisableSandbox: true }));
    answers.push(await ask("WebFetch", { url: "https://x" }));
    yield done();
  });
  const checked: string[] = [];
  await research(sdk, {
    files: {
      cwd: "/work",
      writable: ["/work"],
      denyRead: ["/Users/k/.ssh"],
      check: async (name, input) => (checked.push(name), String(input.file_path ?? "").startsWith("/etc") ? "outside" : undefined),
    },
  });
  const o = seen[0]!.options;
  assert.deepEqual([o.cwd, o.tools, o.maxTurns], ["/work", [...FILE_TOOLS, "Agent"], FILE_MAX_TURNS]);
  assert.deepEqual(o.sandbox, {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: false,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: [], strictAllowlist: true },
    filesystem: { allowWrite: ["/work"], denyRead: ["/Users/k/.ssh"] },
  });
  assert.match(o.systemPrompt, /You work in \/work and in no other folder/);
  assert.deepEqual(answers.map((a) => (a as { behavior: string }).behavior), ["allow", "deny", "deny", "deny"]);
  assert.deepEqual(checked, ["Edit", "Read"], "the sandbox switch is refused before any check; web tools are not file tools");
});

test("only the worker's skills load, through its plugin; a Skill call for another is refused (Task 3.12)", async () => {
  const answers: string[] = [];
  const { sdk, seen } = fakeSdk(async function* (o) {
    yield init();
    for (const skill of ["atom-skills:pdf", "pdf", "atom-skills:council"]) {
      answers.push((await o.canUseTool("Skill", { skill }, { signal: new AbortController().signal })).behavior);
    }
    yield done();
  });
  await research(sdk, { skills: { pluginDir: "/data/skills/sid", plugin: "atom-skills", names: ["pdf"] } });
  const o = seen[0]!.options;
  assert.deepEqual(o.plugins, [{ type: "local", path: "/data/skills/sid", skipMcpDiscovery: true }]);
  assert.deepEqual(o.skills, ["atom-skills:pdf"]);
  assert.deepEqual(o.settingSources, [], "no user settings, so no other skills");
  assert.deepEqual(answers, ["allow", "allow", "deny"]);
  const plain = fakeSdk(async function* () {
    yield init();
    yield done();
  });
  await research(plain.sdk);
  assert.equal(plain.seen[0]!.options.plugins, undefined);
});

test("each skill a run is allowed to use is reported; refused ones are not (ADR-094)", async () => {
  const used: string[] = [];
  const { sdk } = fakeSdk(async function* (o) {
    yield init();
    for (const skill of ["atom-skills:pdf", "atom-skills:council"]) await o.canUseTool("Skill", { skill }, { signal: new AbortController().signal });
    yield done();
  });
  await research(sdk, { skills: { pluginDir: "/p", plugin: "atom-skills", names: ["pdf"] }, onSkill: (name) => used.push(name) });
  assert.deepEqual(used, ["pdf"]);
});

test("Tinker drafts a skill and proposes skill edits with no tools, in their own shapes (ADR-094)", async () => {
  const draft = { name: "compare-laptops", description: "Use when comparing laptops.", body: "1. List needs." };
  const one = fakeSdk(async function* () {
    yield init();
    yield done(draft);
  });
  const base = { claudePath: "/bin/claude", model: "m", task: "Make", instructions: "You are Tinker.", signal: new AbortController().signal, env: {} };
  assert.deepEqual(await runSkillDraft({ ...base, sdk: one.sdk }), { draft });
  const o = one.seen[0]!.options;
  assert.deepEqual([o.tools, o.persistSession, o.mcpServers, o.plugins, o.outputFormat.schema.required], [[], false, {}, undefined, ["name", "description", "body"]]);
  assert.match(o.systemPrompt, /turns one task that Keshab rated as good into a reusable skill/);
  const bad = fakeSdk(async function* () {
    yield init();
    yield done({ ...draft, name: "Not A Name" });
  });
  await assert.rejects(runSkillDraft({ ...base, sdk: bad.sdk }), /skill came back in the wrong shape/);
  const long = fakeSdk(async function* () {
    yield init();
    yield done({ ...draft, body: "x".repeat(8001) });
  });
  await assert.rejects(runSkillDraft({ ...base, sdk: long.sdk }), /wrong shape/);
  const edit = { change: true, body: "1. List needs.\n2. Compare three.", reason: "It stopped at two." };
  const two = fakeSdk(async function* () {
    yield init();
    yield done(edit);
  });
  assert.deepEqual(await runSkillEdit({ ...base, sdk: two.sdk }), { edit });
  assert.deepEqual(two.seen[0]!.options.outputFormat.schema.required, ["change", "body", "reason"]);
  assert.match(two.seen[0]!.options.systemPrompt, /improves one of ATOM's skills/);
});

test("Tinker's review uses no tools and returns one proposed change (Task 3.13)", async () => {
  const review = { change: true, field: "lessons", text: "Give three sources.", reason: "One source was too thin." };
  const { sdk, seen } = fakeSdk(async function* () {
    yield init();
    yield done(review);
  });
  assert.deepEqual(await runReview({ claudePath: "/bin/claude", model: "m", task: "Review", instructions: "You are Tinker.", signal: new AbortController().signal, sdk, env: {} }), { review });
  const o = seen[0]!.options;
  assert.deepEqual([o.tools, o.persistSession, o.outputFormat.schema.required], [[], false, ["change", "field", "text", "reason"]]);
  assert.match(o.systemPrompt, /reviews one task that Keshab rated as not good/);
});

test("a think agent has no tools at all (ADR-088)", async () => {
  let answer: unknown;
  const { sdk, seen } = fakeSdk(async function* (o) {
    yield init();
    answer = await o.canUseTool("WebSearch", { query: "x" }, { signal: new AbortController().signal });
    yield done();
  });
  await research(sdk, { thinkOnly: true });
  assert.deepEqual(seen[0]!.options.tools, []);
  assert.match(seen[0]!.options.systemPrompt, /You have no tools/);
  assert.equal((answer as { behavior: string }).behavior, "deny");
});

test("Keshab's MCP servers join the run; each of their tools is checked (ADR-090)", async () => {
  const answers: string[] = [];
  const { sdk, seen } = fakeSdk(async function* (o) {
    yield init();
    for (const tool of ["mcp__notes__search", "mcp__mail__send", "mcp__stranger__x"]) {
      answers.push((await o.canUseTool(tool, {}, { signal: new AbortController().signal })).behavior);
    }
    yield done();
  });
  await research(sdk, {
    mcp: {
      servers: { notes: { type: "stdio", command: "notes" }, mail: { type: "http", url: "https://x" } },
      check: async (tool) => (tool.includes("mail") ? "Keshab did not allow this tool call." : undefined),
    },
  });
  assert.deepEqual(Object.keys(seen[0]!.options.mcpServers).sort(), ["mail", "notes"]);
  assert.deepEqual(answers, ["allow", "deny", "deny"]);
});

test("progress in plain words, and the twelfth page is the last: further fetches are refused and the report is partial", async () => {
  const steps: string[] = [];
  const answers: string[] = [];
  const { sdk } = fakeSdk(async function* (o) {
    yield init();
    yield toolUse("WebSearch");
    for (let i = 0; i < RESEARCH_PAGE_LIMIT + 2; i++) {
      const answer = await o.canUseTool("WebFetch", { url: "https://example.org" }, { signal: new AbortController().signal });
      answers.push(answer.behavior);
      if (answer.behavior === "deny") assert.match(answer.message, /write the report now/);
    }
    yield toolUse("StructuredOutput");
    yield done();
  });
  const result = await research(sdk, { onStep: (s) => steps.push(s) });
  assert.equal(answers.filter((a) => a === "allow").length, RESEARCH_PAGE_LIMIT);
  assert.deepEqual(answers.slice(-2), ["deny", "deny"]);
  assert.equal(result.partial, true);
  assert.equal(result.pages, 12);
  assert.equal(steps[0], "Searching the web");
  assert.equal(steps[1], "Reading 1 of up to 12 pages");
  assert.equal(steps.at(-2), "Reading 12 of up to 12 pages");
  assert.equal(steps.at(-1), "Writing the report");
});

test("any tool but the two web tools is refused", async () => {
  const { sdk } = fakeSdk(async function* (o) {
    const bash = await o.canUseTool("Bash", { command: "ls" }, { signal: new AbortController().signal });
    assert.equal(bash.behavior, "deny");
    const search = await o.canUseTool("WebSearch", { query: "q" }, { signal: new AbortController().signal });
    assert.equal(search.behavior, "allow");
    yield init();
    yield done();
  });
  await research(sdk);
});

test("a report in the wrong shape fails the job with a clear message", async () => {
  for (const bad of [{ ...report, title: "x".repeat(81) }, { ...report, sources: undefined }, { ...report, extra: 1 }, null]) {
    const { sdk } = fakeSdk(async function* () {
      yield init();
      yield done(bad);
    });
    await assert.rejects(research(sdk), (e: unknown) => e instanceof ProviderError && /wrong shape/.test(e.message));
  }
});

test("the money rule holds: an API key login stops the job, and plan usage is reported", async () => {
  const usage: PlanUsage[] = [];
  const { sdk } = fakeSdk(async function* () {
    yield { type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.4 } } } };
    yield init("ANTHROPIC_API_KEY");
    yield done();
  });
  await assert.rejects(research(sdk, { onUsage: (u) => usage.push(u) }), (e: unknown) => e instanceof ProviderError && e.kind === "auth");
  assert.deepEqual(usage, [{ fiveHour: 0.4 }]);
});

test("too many steps, or an abort, end the job without a report", async () => {
  const { sdk } = fakeSdk(async function* () {
    yield init();
    yield { type: "result", subtype: "error_max_turns", is_error: true };
  });
  await assert.rejects(research(sdk), /more than 30 steps/);

  const controller = new AbortController();
  let aborted: AbortController | undefined;
  const slow = fakeSdk(async function* (o) {
    aborted = o.abortController;
    yield init();
    controller.abort();
    yield done();
  });
  await assert.rejects(research(slow.sdk, { signal: controller.signal }), (e: unknown) => e instanceof ProviderError && e.kind === "cancelled");
  assert.equal(aborted!.signal.aborted, true); // the claude program is stopped
});

// B3.1: the run's tool calls reach onToolCall as short redacted summaries.
test("onToolCall: every tool_use starts a call, every tool_result ends its own by id (also several in one message), a sub-agent's calls name it", async () => {
  const { sdk } = fakeSdk(async function* (o) {
    yield init();
    await o.canUseTool("Agent", { description: "Find it", prompt: "p", subagent_type: "searcher" }, { signal: new AbortController().signal, toolUseID: "s1" });
    yield { type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "WebSearch", input: { query: "tcp" } }, { type: "tool_use", id: "b", name: "WebFetch", input: { url: "https://x.org/p?k=1" } }] } };
    yield { type: "assistant", parent_tool_use_id: "s1", message: { content: [{ type: "tool_use", id: "w", name: "WebSearch", input: { query: "inside" } }] } };
    yield { type: "user", parent_tool_use_id: "s1", message: { content: [{ type: "tool_result", tool_use_id: "w", content: "inside result" }] } };
    yield {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "b", is_error: true, content: "blocked" }, { type: "tool_result", tool_use_id: "a", content: [{ type: "text", text: "key=abc found" }] }] },
    };
    yield done();
  });
  const events: { id: string; agent?: string; tool: string; input: string; state: string; result?: string }[] = [];
  await research(sdk, { onToolCall: (e) => events.push(e) });
  assert.deepEqual(
    events.map((e) => [e.id, e.agent, e.state, e.tool, e.input, e.result]),
    [
      ["a", undefined, "started", "WebSearch", "tcp", undefined],
      ["b", undefined, "started", "WebFetch", "https://x.org/p", undefined],
      ["w", "searcher", "started", "WebSearch", "inside", undefined],
      ["w", "searcher", "ok", "", "", "inside result"],
      ["b", undefined, "error", "", "", "blocked"],
      ["a", undefined, "ok", "", "", "key=[hidden] found"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(events), /=abc/);
});

test("onToolCall: a throwing listener never fails the run, and the step text still shows", async () => {
  const { sdk } = fakeSdk(async function* () {
    yield init();
    yield toolUse("WebSearch");
    yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t", content: "r" }] } };
    yield done();
  });
  const steps: string[] = [];
  const result = await research(sdk, {
    onStep: (s) => steps.push(s),
    onToolCall: () => {
      throw new Error("store is closed");
    },
  });
  assert.equal(result.report.title, report.title);
  assert.deepEqual(steps, ["Searching the web"]);
});

// ADR-098 item 4: a browser task of a worker waits for its turn at the browser, and gives the turn back however it ends.
function browserTurn() {
  const log: string[] = [];
  const browser = {
    name: "atom-browser",
    server: {},
    check: async () => ({ step: "x" }),
    seen: () => {},
    acquire: async (_signal: AbortSignal, onWait: () => void) => (onWait(), log.push("acquire"), () => log.push("release")),
  };
  return { log, browser: browser as unknown as ResearchOptions["browser"] };
}

test("a browser run waits for its turn, says so, and releases when it ends (item 4)", async () => {
  const { log, browser } = browserTurn();
  const steps: string[] = [];
  const { sdk } = fakeSdk(async function* () {
    log.push("start");
    yield init();
    yield done();
  });
  await research(sdk, { browser, onStep: (t) => steps.push(t) });
  assert.deepEqual(log, ["acquire", "start", "release"]);
  assert.equal(steps[0], "Waiting for the browser");
});

test("the browser turn is released when the run errors or is stopped (item 4)", async () => {
  const { log, browser } = browserTurn();
  const bad = fakeSdk(async function* () {
    yield init();
    throw new Error("boom");
  });
  await assert.rejects(research(bad.sdk, { browser }));
  assert.deepEqual(log, ["acquire", "release"]);
  const ctl = new AbortController();
  const stopped = browserTurn();
  const slow = fakeSdk(async function* () {
    yield init();
    ctl.abort();
    yield toolUse("WebSearch");
  });
  await assert.rejects(research(slow.sdk, { browser: stopped.browser, signal: ctl.signal }), /cancel/i);
  assert.deepEqual(stopped.log, ["acquire", "release"]);
});
