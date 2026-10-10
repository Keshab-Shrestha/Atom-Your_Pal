import { test } from "node:test";
import assert from "node:assert/strict";
import { RESEARCH_MAX_TURNS, RESEARCH_PAGE_LIMIT, runResearch, type ResearchOptions } from "./claude-plan-job.ts";
import type { ClaudeSdk, PlanUsage } from "./claude-plan.ts";
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
  assert.deepEqual(o.tools, ["WebSearch", "WebFetch"]);
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
