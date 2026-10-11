// ADR-093: ZENO's chat on another subscription tool Keshab has signed in to on this Mac, through its own program run
// headless and read-only: Codex (`codex exec`, on his ChatGPT plan) or the Gemini CLI (`gemini -p`, on his Google
// sign-in). Chat only: these programs get no ZENO tools (the Core's tools and the team stay on Claude). API keys are
// taken out of their environment, so they always run on the sign-in, never as billed API use. ZENO never reads their
// login files.

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRequest } from "@zeno/contracts";
import { ProviderError, systemText, type ProviderAdapter } from "../gateway.ts";

export const CLI_TIMEOUT_MS = 120_000;

/** Runs a program and gives back what it printed; rejects with the error (its `stderr` and `code` attached). */
export type CliRunner = (program: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; signal: AbortSignal }) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: CliRunner = (program, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(program, args, { ...options, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stderr: String(stderr) }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    // Nothing comes on stdin: Codex waits for more input while stdin is open.
    child.stdin?.end();
  });

/** The environment without any provider's API key, so the program uses its sign-in. */
export function signedInEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^(OPENAI|ANTHROPIC|GEMINI|GOOGLE)_API_KEY$|^GOOGLE_GENAI_USE_VERTEXAI$/.test(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/** One text for a program that takes a single prompt: the instructions, the conversation, then what to do. */
export function promptText(request: ModelRequest): string {
  const turns = request.messages
    .filter((m) => m.content.trim())
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`)
    .join("\n\n");
  return `${systemText(request)}\n\nThe conversation so far:\n\n${turns}\n\nReply to the user's last message as the assistant. Give only the reply, as plain text that reads well aloud. You have no tools here: do not run commands or edit files.`;
}

/** What a failed run means, in words for Keshab. Never the program's full output. */
function failure(tool: string, signIn: string, error: unknown, signal: AbortSignal): ProviderError {
  if (signal.aborted) return new ProviderError("cancelled", `${tool} was stopped.`);
  const e = error as { code?: unknown; killed?: boolean; stderr?: string; message?: string };
  if (e.code === "ENOENT") return new ProviderError("auth", `${tool} was not found on this Mac. ${signIn}`);
  if (e.killed) return new ProviderError("timeout", `${tool} took longer than ${CLI_TIMEOUT_MS / 1000} seconds.`);
  const said = `${e.stderr ?? ""}\n${e.message ?? ""}`;
  if (/not (logged|signed) in|login required|unauthori[sz]ed|authenticat|401/i.test(said)) return new ProviderError("auth", `${tool} is not signed in. ${signIn}`);
  if (/rate.?limit|quota|429|usage limit/i.test(said)) return new ProviderError("rate_limit", `${tool} has reached its limit for now.`);
  const line = said.split("\n").map((l) => l.trim()).find((l) => l && !/^\s*at /.test(l)) ?? "it stopped with an error";
  return new ProviderError("unknown", `${tool} could not answer: ${line.slice(0, 160)}`);
}

export interface CliToolOptions {
  /** The signed-in program's full path. */
  program: string;
  /** "codex-default" / "gemini-default" leave the choice to the program. */
  model: string;
  run?: CliRunner;
  env?: NodeJS.ProcessEnv;
}

/** Codex on Keshab's ChatGPT plan: `codex exec`, read-only, nothing kept, the last message read from a file. */
export function createCodexAdapter(options: CliToolOptions): ProviderAdapter {
  const run = options.run ?? defaultRunner;
  return {
    name: "codex",
    async complete(request, signal) {
      const dir = mkdtempSync(join(tmpdir(), "zeno-codex-"));
      const out = join(dir, "reply.txt");
      try {
        const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--output-last-message", out];
        if (options.model !== "codex-default") args.push("--model", options.model);
        args.push(promptText(request));
        let stdout = "";
        try {
          ({ stdout } = await run(options.program, args, { cwd: dir, env: signedInEnv(options.env), timeout: CLI_TIMEOUT_MS, signal }));
        } catch (error) {
          throw failure("Codex", "Run `codex login` and sign in with ChatGPT, then try again.", error, signal);
        }
        let text = "";
        try {
          text = readFileSync(out, "utf8").trim();
        } catch {
          text = stdout.trim().split("\n").at(-1)?.trim() ?? "";
        }
        if (!text) throw new ProviderError("unknown", "Codex returned no text. Try again.");
        return { text };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** The Gemini CLI on Keshab's Google sign-in: `gemini -p`, plan (read-only) mode, its JSON answer. */
export function createGeminiCliAdapter(options: CliToolOptions): ProviderAdapter {
  const run = options.run ?? defaultRunner;
  return {
    name: "gemini-cli",
    async complete(request, signal) {
      const dir = mkdtempSync(join(tmpdir(), "zeno-gemini-"));
      try {
        // A fresh folder each time: --skip-trust lets the CLI run headless there (it would otherwise ask).
        const args = ["--prompt", promptText(request), "--output-format", "json", "--approval-mode", "plan", "--skip-trust"];
        if (options.model !== "gemini-default") args.push("--model", options.model);
        const signIn = "Run `gemini` once in Terminal and sign in with Google, then try again.";
        let stdout = "";
        let stderr = "";
        try {
          ({ stdout, stderr } = await run(options.program, args, { cwd: dir, env: signedInEnv(options.env), timeout: CLI_TIMEOUT_MS, signal }));
        } catch (error) {
          throw failure("The Gemini CLI", signIn, error, signal);
        }
        // Nothing on stdout: its error (such as a 401 when no one is signed in) is on stderr.
        if (!stdout.trim() && stderr.trim()) throw failure("The Gemini CLI", signIn, { stderr }, signal);
        let text = stdout.trim();
        try {
          const parsed = JSON.parse(text) as { response?: unknown; error?: { message?: unknown } };
          if (parsed.error) throw failure("The Gemini CLI", signIn, { stderr: String(parsed.error.message ?? "") }, signal);
          if (typeof parsed.response === "string") text = parsed.response.trim();
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          // Not JSON (an older CLI): its plain text is the answer.
        }
        if (!text) throw new ProviderError("unknown", "The Gemini CLI returned no text. Try again.");
        return { text };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
