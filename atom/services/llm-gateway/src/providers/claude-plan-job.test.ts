import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_TOOL_MAX_TURNS, runChatDigest, runNote, runReview, runSkillDraft, runSkillEdit, runTestAnswer, type NoToolOptions } from "./claude-plan-job.ts";
import type { ClaudeSdk, PlanUsage } from "./plan-support.ts";
import { ProviderError } from "../gateway.ts";

// The SDK is replaced by a script, as Claude Code would answer.
type Msg = Record<string, unknown>;
type Options = Record<string, any>;

const init = (apiKeySource = "none"): Msg => ({ type: "system", subtype: "init", apiKeySource });
const done = (structured: unknown): Msg => ({ type: "result", subtype: "success", is_error: false, result: "", structured_output: structured });

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

const base = (sdk: ClaudeSdk, over: Partial<NoToolOptions> = {}): NoToolOptions => ({
  claudePath: "/bin/claude",
  model: "claude-haiku-5",
  task: "The task.",
  instructions: "You are Tinker.",
  signal: new AbortController().signal,
  sdk,
  env: { PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-x", CLAUDE_CODE_OAUTH_TOKEN: "t" },
  ...over,
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

test("a run has one separate session with no tools, no settings and nothing from the account (ADR-110 N5)", async () => {
  const { sdk, seen } = fakeSdk(async function* () {
    yield init();
    yield done({ answer: "Use TCP." });
  });
  assert.deepEqual(await runTestAnswer(base(sdk)), { answer: "Use TCP." });
  const { prompt, options: o } = seen[0]!;
  assert.match(prompt, /The task\./);
  assert.equal(o.pathToClaudeCodeExecutable, "/bin/claude");
  assert.equal(o.model, "claude-haiku-5");
  assert.deepEqual([o.tools, o.allowedTools, o.mcpServers, o.settingSources], [[], [], {}, []]);
  assert.equal(o.strictMcpConfig, true);
  assert.equal(o.persistSession, false);
  assert.equal(o.permissionMode, "default");
  assert.equal(o.maxTurns, NO_TOOL_MAX_TURNS);
  assert.equal(o.outputFormat.type, "json_schema");
  assert.equal(o.outputFormat.schema.$schema, undefined); // Claude Code refuses the draft marker
  assert.equal(o.env.ANTHROPIC_API_KEY, undefined); // never billed per token
  assert.equal(o.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.match(o.systemPrompt, /^You are Tinker\./);
  assert.equal((await o.canUseTool("Bash", {})).behavior, "deny");
  assert.equal((await o.canUseTool("StructuredOutput", { x: 1 })).behavior, "allow");
});

test("the chat digest and the conversation note come back in their own shapes", async () => {
  const digest = { summary: "Planning a trip.", headings: ["Flights"] };
  const one = fakeSdk(async function* () {
    yield init();
    yield done(digest);
  });
  assert.deepEqual(await runChatDigest(base(one.sdk)), { digest });
  assert.deepEqual(one.seen[0]!.options.outputFormat.schema.required, ["summary", "headings"]);
  const note = fakeSdk(async function* () {
    yield init();
    yield { ...done({ note: "The user booked a flight." }), usage: { input_tokens: 5, output_tokens: 2 } };
  });
  const out = await runNote(base(note.sdk));
  assert.equal(out.note, "The user booked a flight.");
  assert.deepEqual(out.tokens, { input: 5, output: 2, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(note.seen[0]!.options.outputFormat.schema.required, ["note"]);
  assert.match(note.seen[0]!.options.systemPrompt, /private note about a conversation/);
  const bad = fakeSdk(async function* () {
    yield init();
    yield done({ note: "" });
  });
  await assert.rejects(runNote(base(bad.sdk)), /wrong shape/);
});

test("the money rule holds: an API key login stops the run, and plan usage is reported", async () => {
  const usage: PlanUsage[] = [];
  const { sdk } = fakeSdk(async function* () {
    yield { type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.4 } } } };
    yield init("ANTHROPIC_API_KEY");
    yield done({ answer: "x" });
  });
  await assert.rejects(runTestAnswer(base(sdk, { onUsage: (u) => usage.push(u) })), (e: unknown) => e instanceof ProviderError && e.kind === "auth");
  assert.deepEqual(usage, [{ fiveHour: 0.4 }]);
});

test("too many steps, or an abort, end the run without an answer", async () => {
  const { sdk } = fakeSdk(async function* () {
    yield init();
    yield { type: "result", subtype: "error_max_turns", is_error: true };
  });
  await assert.rejects(runTestAnswer(base(sdk)), /more than 30 steps/);

  const controller = new AbortController();
  let aborted: AbortController | undefined;
  const slow = fakeSdk(async function* (o) {
    aborted = o.abortController;
    yield init();
    controller.abort();
    yield done({ answer: "x" });
  });
  await assert.rejects(runTestAnswer(base(slow.sdk, { signal: controller.signal })), (e: unknown) => e instanceof ProviderError && e.kind === "cancelled");
  assert.equal(aborted!.signal.aborted, true); // the claude program is stopped
});
