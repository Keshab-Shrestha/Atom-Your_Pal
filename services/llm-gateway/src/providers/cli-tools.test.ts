import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { ModelRequest } from "@atom/contracts";
import { PROJECTS_NEED_CLAUDE, createCodexAdapter, failure, createGeminiCliAdapter, promptText, signedInEnv, type CliRunner } from "./cli-tools.ts";

// ADR-093: ATOM's chat on Codex (ChatGPT plan) or the Gemini CLI (Google sign-in), headless and read-only.

const request = (): ModelRequest => ({
  system: "You are ATOM.",
  systemExtra: "It is Sunday.",
  messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello!" }, { role: "user", content: "Weather?" }],
  context: { requestId: "r", sessionId: "s", source: "text", receivedAt: new Date(0) },
});
const live = () => new AbortController().signal;

test("the prompt carries the instructions, the conversation and no tools", () => {
  const text = promptText(request());
  assert.match(text, /^You are ATOM\.\n\nIt is Sunday\./);
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

// ADR-107: a project chat needs the file tools only Claude Code runs under ATOM's checks.
test("Codex and the Gemini CLI refuse a project chat, before any process starts", async () => {
  const run: CliRunner = async () => assert.fail("no process may start");
  const files = { cwd: "/x", check: async () => undefined };
  for (const adapter of [createCodexAdapter({ program: "/x/codex", model: "codex-default", run }), createGeminiCliAdapter({ program: "/x/gemini", model: "gemini-default", run })]) {
    await assert.rejects(adapter.complete({ ...request(), files }, live()), (e: any) => e.kind === "bad_request" && e.message === PROJECTS_NEED_CLAUDE);
  }
  assert.match(PROJECTS_NEED_CLAUDE, /Projects need the Claude plan/);
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
