import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { ModelRequest } from "@ark/contracts";
import { PROJECTS_NEED_CLAUDE, OPENCODE_CHAT_CONFIG, createCodexAdapter, createCopilotAdapter, createOpenCodeAdapter, defaultRunner, failure, createGeminiCliAdapter, promptText, readOpenCodeEvents, signedInEnv, type CliRunner } from "./cli-tools.ts";

// ADR-093: ARK's chat on Codex (ChatGPT plan) or the Gemini CLI (Google sign-in), headless and read-only.

const request = (): ModelRequest => ({
  system: "You are ARK.",
  systemExtra: "It is Sunday.",
  messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello!" }, { role: "user", content: "Weather?" }],
  context: { requestId: "r", sessionId: "s", source: "text", receivedAt: new Date(0) },
});
const live = () => new AbortController().signal;

test("the prompt carries the instructions, the conversation and no tools", () => {
  const text = promptText(request());
  assert.match(text, /^You are ARK\.\n\nIt is Sunday\./);
  assert.match(text, /User: Hi\n\nAssistant: Hello!\n\nUser: Weather\?/);
  assert.match(text, /no tools here/);
});

test("API keys are taken out, so the tools run on their sign-in, never billed API use", () => {
  const env = signedInEnv({ PATH: "/bin", OPENAI_API_KEY: "a", GEMINI_API_KEY: "b", GOOGLE_API_KEY: "c", ANTHROPIC_API_KEY: "d", HOME: "/h" });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/h" });
});

test("Codex runs `codex exec` read-only and answers with its last message", async () => {
  const calls: string[][] = [];
  const run: CliRunner = async (program, args, options) => {
    calls.push([program, ...args]);
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    writeFileSync(args[args.indexOf("--output-last-message") + 1]!, "  Sunny today.\n");
    return { stdout: "", stderr: "" };
  };
  const codex = createCodexAdapter({ program: "/x/codex", model: "codex-default", run, env: { OPENAI_API_KEY: "k" } });
  assert.deepEqual(await codex.complete(request(), live()), { text: "Sunny today." });
  assert.deepEqual(calls[0]!.slice(0, 7), ["/x/codex", "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--output-last-message"]);
  assert.ok(!calls[0]!.includes("--model"), "its own model unless one is chosen");
  await createCodexAdapter({ program: "/x/codex", model: "gpt-x", run }).complete(request(), live());
  assert.deepEqual(calls[1]!.slice(8, 10), ["--model", "gpt-x"]);
});

test("the Gemini CLI runs headless in plan mode and answers with its JSON response", async () => {
  const calls: string[][] = [];
  const gemini = createGeminiCliAdapter({
    program: "/x/gemini",
    model: "gemini-default",
    run: async (program, args) => (calls.push([program, ...args]), { stdout: JSON.stringify({ response: " Rain later. ", stats: {} }), stderr: "" }),
  });
  assert.deepEqual(await gemini.complete(request(), live()), { text: "Rain later." });
  assert.deepEqual([calls[0]![1], calls[0]!.slice(3)], ["--prompt", ["--output-format", "json", "--approval-mode", "plan", "--skip-trust"]]);
  const plain = createGeminiCliAdapter({ program: "/x/gemini", model: "gemini-default", run: async () => ({ stdout: "Older CLI text", stderr: "" }) });
  assert.deepEqual(await plain.complete(request(), live()), { text: "Older CLI text" });
});

test("failures are said in words: not signed in, not found, a limit", async () => {
  const failing = (stderr: string, code?: string): CliRunner => async () => {
    throw Object.assign(new Error("Command failed"), { stderr, ...(code ? { code } : {}) });
  };
  await assert.rejects(createCodexAdapter({ program: "/x/codex", model: "codex-default", run: failing("Error: Not logged in") }).complete(request(), live()),
    (e: unknown) => (e as { kind: string }).kind === "auth" && /Codex is not signed in\. Run `codex login`/.test((e as Error).message));
  await assert.rejects(createGeminiCliAdapter({ program: "/x/gemini", model: "gemini-default", run: failing("", "ENOENT") }).complete(request(), live()),
    /The Gemini CLI was not found on this Mac/);
  await assert.rejects(createCodexAdapter({ program: "/x/codex", model: "codex-default", run: failing("429 usage limit reached") }).complete(request(), live()),
    (e: unknown) => (e as { kind: string }).kind === "rate_limit");
  await assert.rejects(createGeminiCliAdapter({ program: "/x/gemini", model: "gemini-default", run: async () => ({ stdout: JSON.stringify({ error: { message: "authentication required" } }), stderr: "" }) }).complete(request(), live()),
    /The Gemini CLI is not signed in/);
  // As on this Mac before signing in: nothing on stdout, a 401 on stderr.
  await assert.rejects(createGeminiCliAdapter({ program: "/x/gemini", model: "gemini-default", run: async () => ({ stdout: "", stderr: '{ "error": { "code": 401 } }' }) }).complete(request(), live()),
    (e: unknown) => (e as { kind: string }).kind === "auth");
});

// ADR-107: a project chat needs the file tools only Claude Code runs under ARK's checks.
test("Codex and the Gemini CLI refuse a project chat, before any process starts", async () => {
  const run: CliRunner = async () => assert.fail("no process may start");
  const files = { cwd: "/x", check: async () => undefined };
  for (const adapter of [createCodexAdapter({ program: "/x/codex", model: "codex-default", run }), createGeminiCliAdapter({ program: "/x/gemini", model: "gemini-default", run })]) {
    await assert.rejects(adapter.complete({ ...request(), files }, live()), (e: any) => e.kind === "bad_request" && e.message === PROJECTS_NEED_CLAUDE);
  }
  assert.match(PROJECTS_NEED_CLAUDE, /text-only adapter cannot read project files/);
});

// 2026-10-16 (code check): the error's message holds the command line, which includes the prompt: a chat about "quota" read as a limit.
test("a failure is classified from what the tool printed, not from the command line with the prompt in it", () => {
  const signal = new AbortController().signal;
  const error = Object.assign(new Error("Command failed: codex exec tell me about the quota and the 401 error"), { stderr: "something broke" });
  const result = failure("Codex", "Sign in.", error, signal);
  assert.equal(result.kind, "unknown");
  assert.match(result.message, /something broke/);
  assert.equal(failure("Codex", "Sign in.", Object.assign(new Error("x"), { stderr: "Error: 401 unauthorized" }), signal).kind, "auth");
  assert.equal(failure("Codex", "Sign in.", Object.assign(new Error("x"), { stderr: "rate limit reached" }), signal).kind, "rate_limit");
});

test("Gemini refuses restricted modes before starting a CLI with native tools it cannot host-gate", async () => {
  let runs = 0;
  const adapter = createGeminiCliAdapter({ program: "/x/gemini", model: "gemini-default", run: async () => { runs++; return { stdout: "unexpected", stderr: "" }; } });
  for (const access of ["chat-only", "ask-changes", "full"] as const) await assert.rejects(adapter.complete({ ...request(), access }, live()), /cannot enforce this chat access mode/);
  assert.equal(runs, 0);
});

// ADR-270: the GitHub Copilot CLI and OpenCode as chat providers, with their own tools off.

test("API keys, GitHub tokens and tool overrides are taken out for Copilot and OpenCode", () => {
  const env = signedInEnv({ PATH: "/bin", GH_TOKEN: "a", GITHUB_TOKEN: "b", COPILOT_GITHUB_TOKEN: "c", COPILOT_PROVIDER_API_KEY: "d", COPILOT_PROVIDER_BASE_URL: "e",
    COPILOT_ALLOW_ALL: "true", OPENROUTER_API_KEY: "f", OPENCODE_PERMISSION: "{}", OPENCODE_CONFIG_CONTENT: "{}", OPENCODE_CONFIG: "/c.json", COPILOT_HOME: "/h" });
  assert.deepEqual(env, { PATH: "/bin", OPENCODE_CONFIG: "/c.json", COPILOT_HOME: "/h" });
});

test("Copilot runs `copilot -p` silent with every tool hidden and shell, writes and URLs denied", async () => {
  const calls: string[][] = [];
  const run: CliRunner = async (program, args, options) => {
    calls.push([program, ...args]);
    assert.equal(options.env.GH_TOKEN, undefined);
    assert.equal(options.timeout, 120_000);
    return { stdout: "  Sunny today.\n", stderr: "" };
  };
  const copilot = createCopilotAdapter({ program: "/x/copilot", model: "copilot-default", run, env: { GH_TOKEN: "t", PATH: "/bin" } });
  assert.equal(copilot.name, "copilot");
  assert.deepEqual(await copilot.complete(request(), live()), { text: "Sunny today." });
  const args = calls[0]!;
  assert.deepEqual(args.slice(0, 2), ["/x/copilot", "--prompt"]);
  assert.match(args[2]!, /User: Weather\?/);
  for (const flag of ["--silent", "--no-ask-user", "--no-custom-instructions", "--disable-builtin-mcps", "--disallow-temp-dir", "--deny-tool=shell", "--deny-tool=write", "--deny-tool=url"]) assert.ok(args.includes(flag), flag);
  const excluded = args.find((a) => a.startsWith("--excluded-tools="))!.slice("--excluded-tools=".length).split(",");
  for (const tool of ["bash", "edit", "create", "apply_patch", "view", "web_fetch", "task", "ask_user"]) assert.ok(excluded.includes(tool), tool);
  assert.ok(!args.some((a) => /allow-all|--allow-tool|--yolo|--model/.test(a)), "no allow flag, and its own model unless one is chosen");
  await createCopilotAdapter({ program: "/x/copilot", model: "claude-haiku-5.5", run }).complete(request(), live());
  assert.equal(calls[1]!.at(-1), "--model=claude-haiku-5.5");
});

test("Copilot failures are said in words: not found, not signed in, empty", async () => {
  const failing = (stderr: string, code?: string): CliRunner => async () => { throw Object.assign(new Error("Command failed"), { stderr, ...(code ? { code } : {}) }); };
  const adapter = (run: CliRunner) => createCopilotAdapter({ program: "/x/copilot", model: "copilot-default", run });
  await assert.rejects(adapter(failing("", "ENOENT")).complete(request(), live()), (e: any) => e.kind === "auth" && /The Copilot CLI was not found on this Mac/.test(e.message));
  await assert.rejects(adapter(failing("Error: No authentication information found.")).complete(request(), live()),
    (e: any) => e.kind === "auth" && /The Copilot CLI is not signed in\. Run `copilot login`/.test(e.message));
  await assert.rejects(adapter(async () => ({ stdout: "", stderr: "Error: not logged in" })).complete(request(), live()), (e: any) => e.kind === "auth");
  await assert.rejects(adapter(async () => ({ stdout: "  ", stderr: "" })).complete(request(), live()), /returned no text/);
});

test("OpenCode runs `opencode run --format json` with every permission denied and joins its text events", async () => {
  const calls: { args: string[]; env: NodeJS.ProcessEnv; cwd: string }[] = [];
  const events = [
    { type: "step_start", part: {} },
    { type: "text", part: { type: "text", text: "Rain " } },
    { type: "tool_use", part: { tool: "bash" } },
    { type: "text", part: { type: "text", text: "later." } },
    { type: "step_finish", part: {} },
  ].map((e) => JSON.stringify(e)).join("\n");
  const run: CliRunner = async (_program, args, options) => (calls.push({ args, env: options.env, cwd: options.cwd }), { stdout: `${events}\n`, stderr: "" });
  const opencode = createOpenCodeAdapter({ program: "/x/opencode", model: "opencode-default", run, env: { ANTHROPIC_API_KEY: "k", PATH: "/bin" } });
  assert.equal(opencode.name, "opencode");
  assert.deepEqual(await opencode.complete(request(), live()), { text: "Rain later." });
  const { args, env, cwd } = calls[0]!;
  assert.deepEqual(args.slice(0, 5), ["run", "--format", "json", "--dir", cwd]);
  assert.equal(args.length, 6, "its own model unless one is chosen");
  assert.match(args[5]!, /^You are ARK\./);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT!), { permission: { "*": "deny" }, autoupdate: false });
  assert.equal(env.OPENCODE_CONFIG_CONTENT, OPENCODE_CHAT_CONFIG);
  await createOpenCodeAdapter({ program: "/x/opencode", model: "anthropic/claude-sonnet-5-5", run }).complete(request(), live());
  assert.deepEqual(calls[1]!.args.slice(5, 7), ["--model", "anthropic/claude-sonnet-5-5"]);
});

test("OpenCode error events become clear errors, in both event shapes and on a failed exit", async () => {
  // v1.x: { name, data: { message } }; later builds: { type, message }.
  assert.deepEqual(readOpenCodeEvents('{"type":"error","error":{"name":"APIError","data":{"message":"Unauthorized: invalid api key"}}}'), { text: "", error: "Unauthorized: invalid api key", events: 1 });
  assert.equal(readOpenCodeEvents('{"type":"error","error":{"type":"unknown","message":"Model not found"}}').error, "Model not found");
  assert.deepEqual(readOpenCodeEvents("not json\nnull\n"), { text: "", events: 0 });
  const adapter = (run: CliRunner) => createOpenCodeAdapter({ program: "/x/opencode", model: "opencode-default", run });
  const exitWith = (stdout: string): CliRunner => async () => { throw Object.assign(new Error("Command failed: opencode run ... prompt"), { code: 1, stdout, stderr: "" }); };
  await assert.rejects(adapter(exitWith('{"type":"error","error":{"name":"ProviderAuthError","data":{"message":"401 unauthorized"}}}')).complete(request(), live()),
    (e: any) => e.kind === "auth" && /OpenCode is not signed in\. Run `opencode auth login`/.test(e.message));
  await assert.rejects(adapter(exitWith('{"type":"error","error":{"type":"unknown","message":"Model not found: x/y"}}')).complete(request(), live()),
    (e: any) => e.kind === "unknown" && /OpenCode could not answer: Model not found: x\/y/.test(e.message));
  await assert.rejects(adapter(async () => ({ stdout: '{"type":"error","error":{"message":"rate limit reached"}}', stderr: "" })).complete(request(), live()), (e: any) => e.kind === "rate_limit");
  await assert.rejects(adapter(async () => { throw Object.assign(new Error("spawn"), { code: "ENOENT" }); }).complete(request(), live()), /OpenCode was not found on this Mac/);
  assert.deepEqual(await adapter(async () => ({ stdout: "plain answer\n", stderr: "" })).complete(request(), live()), { text: "plain answer" });
});

test("Copilot and OpenCode refuse a project chat and tool access modes before any process starts, and allow chat-only", async () => {
  let runs = 0;
  const run: CliRunner = async () => { runs++; return { stdout: '{"type":"text","part":{"text":"ok"}}', stderr: "" }; };
  const files = { cwd: "/x", check: async () => undefined };
  for (const adapter of [createCopilotAdapter({ program: "/x/copilot", model: "copilot-default", run }), createOpenCodeAdapter({ program: "/x/opencode", model: "opencode-default", run })]) {
    await assert.rejects(adapter.complete({ ...request(), files }, live()), (e: any) => e.kind === "bad_request" && e.message === PROJECTS_NEED_CLAUDE);
    for (const access of ["ask-changes", "full"] as const) await assert.rejects(adapter.complete({ ...request(), access }, live()), /answers with text only in ARK/);
  }
  assert.equal(runs, 0);
  for (const adapter of [createCopilotAdapter({ program: "/x/copilot", model: "copilot-default", run }), createOpenCodeAdapter({ program: "/x/opencode", model: "opencode-default", run })]) {
    await adapter.complete({ ...request(), access: "chat-only" }, live());
  }
  assert.equal(runs, 2);
});

test("a stop or a timeout kills the program: the real runner on a slow child", async () => {
  // A stand-in program that never answers: `node -e` waiting 60 s.
  const slow: CliRunner = (_p, _args, options) => defaultRunner(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], options);
  const controller = new AbortController();
  const started = Date.now();
  const pending = createCopilotAdapter({ program: "/x/copilot", model: "copilot-default", run: slow }).complete(request(), controller.signal);
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, (e: any) => e.kind === "cancelled" && /The Copilot CLI was stopped/.test(e.message));
  assert.ok(Date.now() - started < 5_000, "the child was killed, not waited for");
  const timed: CliRunner = (_p, _args, options) => defaultRunner(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { ...options, timeout: 100 });
  await assert.rejects(createOpenCodeAdapter({ program: "/x/opencode", model: "opencode-default", run: timed }).complete(request(), live()),
    (e: any) => e.kind === "timeout" && /OpenCode took longer than 120 seconds/.test(e.message));
});
