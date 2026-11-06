// ADR-093: ARK's chat on another subscription tool Keshab has signed in to on this Mac, through its own program run
// headless and read-only: Codex (`codex exec`, on his ChatGPT plan) or the Gemini CLI (`gemini -p`, on his Google
// sign-in). Chat only: these programs get no ARK tools (the Core's tools and the team stay on Claude). API keys are
// taken out of their environment, so they always run on the sign-in, never as billed API use. ARK never reads their
// login files. ADR-270: the GitHub Copilot CLI (`copilot -p`) and OpenCode (`opencode run`) the same way, with their
// own tools off.

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRequest } from "@ark/contracts";
import { ProviderError, systemText, type ProviderAdapter } from "../gateway.ts";

export const CLI_TIMEOUT_MS = 120_000;

/** Runs a program and gives back what it printed; rejects with the error (its `stderr` and `code` attached). */
export type CliRunner = (program: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; signal: AbortSignal }) => Promise<{ stdout: string; stderr: string }>;

export const defaultRunner: CliRunner = (program, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(program, args, { ...options, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout: String(stdout), stderr: String(stderr) }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    // Nothing comes on stdin: Codex waits for more input while stdin is open.
    child.stdin?.end();
  });

/**
 * The environment without any provider's API key or token, so the program uses its sign-in. ADR-270: GitHub tokens
 * (they win over the Copilot CLI's login), Copilot's own-key provider and allow-all settings, and OpenCode's inline
 * config and permissions (ARK sets its own) are taken out too.
 */
export function signedInEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (/_API_KEY$|^GOOGLE_GENAI_USE_VERTEXAI$|^(GH|GITHUB|COPILOT_GITHUB)_TOKEN$|^COPILOT_(PROVIDER_|ALLOW_ALL$)|^OPENCODE_(CONFIG_CONTENT|PERMISSION)$/.test(key)) continue;
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
/** ADR-107: a project chat needs file tools, which only Claude Code runs under ARK's checks. */
export const PROJECTS_NEED_CLAUDE = "This text-only adapter cannot read project files. Pick Claude or Codex in ARK's chat to use its checked file tools.";

export function failure(tool: string, signIn: string, error: unknown, signal: AbortSignal): ProviderError {
  if (signal.aborted) return new ProviderError("cancelled", `${tool} was stopped.`);
  const e = error as { code?: unknown; killed?: boolean; stderr?: string; message?: string };
  if (e.code === "ENOENT") return new ProviderError("auth", `${tool} was not found on this Mac. ${signIn}`);
  if (e.killed) return new ProviderError("timeout", `${tool} took longer than ${CLI_TIMEOUT_MS / 1000} seconds.`);
  // Only what the tool printed: the error's message holds the whole command line, which includes the prompt, so a chat that mentions "quota" or "401" was read as a limit or a sign-in problem.
  const said = e.stderr ?? "";
  if (/not (logged|signed) in|login required|unauthori[sz]ed|authenticat|401|api.?key/i.test(said)) return new ProviderError("auth", `${tool} is not signed in. ${signIn}`);
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
      if (request.files) throw new ProviderError("bad_request", PROJECTS_NEED_CLAUDE);
      const dir = mkdtempSync(join(tmpdir(), "ark-codex-"));
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
      if (request.access && request.access !== "checked") throw new ProviderError("bad_request", "The Gemini CLI cannot enforce this chat access mode. Choose Claude or Codex, or return to Saved permissions.");
      if (request.files) throw new ProviderError("bad_request", PROJECTS_NEED_CLAUDE);
      const dir = mkdtempSync(join(tmpdir(), "ark-gemini-"));
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

/** ADR-270: chat refuses access modes that promise ARK's tools; these programs answer with text only. */
function refuseToolModes(tool: string, request: ModelRequest): void {
  if (request.access === "ask-changes" || request.access === "full") throw new ProviderError("bad_request", `${tool} answers with text only in ARK. Choose Claude or Codex, or return to Saved permissions.`);
  if (request.files) throw new ProviderError("bad_request", PROJECTS_NEED_CLAUDE);
}

/**
 * ADR-270: every Copilot CLI tool, from the "Tool availability values" table of
 * https://docs.github.com/en/copilot/reference/cli-command-reference . All are hidden from the model.
 */
const COPILOT_TOOLS = [
  "bash", "powershell", "list_bash", "list_powershell", "read_bash", "read_powershell", "stop_bash", "stop_powershell", "write_bash", "write_powershell",
  "apply_patch", "create", "edit", "view", "list_agents", "read_agent", "task", "write_agent", "ask_user", "glob", "grep", "rg", "skill", "web_fetch",
];

/**
 * ADR-270: the GitHub Copilot CLI on Keshab's GitHub sign-in: `copilot -p`, text only. Flags from
 * https://docs.github.com/en/copilot/reference/cli-command-reference and
 * https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference :
 * `-s` prints only the answer; its tools are hidden (`--excluded-tools`), shell, file writes and URLs are denied
 * (`--deny-tool`), and no allow flag is given, so a `-p` run denies anything else that needs approval. No GitHub MCP
 * server, no AGENTS.md, no questions back, no temporary-folder access.
 */
export function createCopilotAdapter(options: CliToolOptions): ProviderAdapter {
  const run = options.run ?? defaultRunner;
  const tool = "The Copilot CLI";
  const signIn = "Run `copilot login` in Terminal and sign in with GitHub, then try again.";
  return {
    name: "copilot",
    async complete(request, signal) {
      refuseToolModes(tool, request);
      const dir = mkdtempSync(join(tmpdir(), "ark-copilot-"));
      try {
        const args = ["--prompt", promptText(request), "--silent", "--no-auto-update", "--no-ask-user", "--no-custom-instructions", "--disable-builtin-mcps", "--disallow-temp-dir",
          `--excluded-tools=${COPILOT_TOOLS.join(",")}`, "--deny-tool=shell", "--deny-tool=write", "--deny-tool=url"];
        if (options.model !== "copilot-default") args.push(`--model=${options.model}`);
        let stdout = "";
        let stderr = "";
        try {
          ({ stdout, stderr } = await run(options.program, args, { cwd: dir, env: signedInEnv(options.env), timeout: CLI_TIMEOUT_MS, signal }));
        } catch (error) {
          throw failure(tool, signIn, error, signal);
        }
        const text = stdout.trim();
        if (!text && stderr.trim()) throw failure(tool, signIn, { stderr }, signal);
        if (!text) throw new ProviderError("unknown", `${tool} returned no text. Try again.`);
        return { text };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** ADR-270: OpenCode's config for an ARK chat: every tool denied, no update check. `*` is the catch-all permission rule. */
export const OPENCODE_CHAT_CONFIG = JSON.stringify({ permission: { "*": "deny" }, autoupdate: false });

/** The answer and any error in `opencode run --format json` output (one JSON event per line). */
export function readOpenCodeEvents(stdout: string): { text: string; error?: string; events: number } {
  let text = "";
  let error: string | undefined;
  let events = 0;
  for (const line of stdout.split("\n")) {
    let event: { type?: unknown; part?: { text?: unknown }; error?: { message?: unknown; name?: unknown; data?: { message?: unknown } } };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== "object") continue;
    events++;
    // A text event carries a whole part (v1.x) or the new part of one (later builds): joined, both give the answer.
    if (event.type === "text" && typeof event.part?.text === "string") text += event.part.text;
    if (event.type === "error") error = String(event.error?.message ?? event.error?.data?.message ?? event.error?.name ?? "it stopped with an error");
  }
  return { text: text.trim(), ...(error ? { error } : {}), events };
}

/**
 * ADR-270: OpenCode on the providers Keshab signed in to with `opencode auth login`: `opencode run`, text only. Flags
 * from https://opencode.ai/docs/cli/ (`run`, `--format json`, `--model provider/model`, `--dir`); the deny-all
 * permission from https://opencode.ai/docs/permissions/ and https://opencode.ai/docs/config/ (OPENCODE_CONFIG_CONTENT).
 * Event shapes from github.com/anomalyco/opencode run.ts. A non-interactive run rejects anything that would ask.
 */
export function createOpenCodeAdapter(options: CliToolOptions): ProviderAdapter {
  const run = options.run ?? defaultRunner;
  const tool = "OpenCode";
  const signIn = "Run `opencode auth login` in Terminal and add a provider, then try again.";
  return {
    name: "opencode",
    async complete(request, signal) {
      refuseToolModes(tool, request);
      const dir = mkdtempSync(join(tmpdir(), "ark-opencode-"));
      try {
        const args = ["run", "--format", "json", "--dir", dir];
        if (options.model !== "opencode-default") args.push("--model", options.model);
        args.push(promptText(request));
        const env = { ...signedInEnv(options.env), OPENCODE_CONFIG_CONTENT: OPENCODE_CHAT_CONFIG };
        let stdout = "";
        let stderr = "";
        try {
          ({ stdout, stderr } = await run(options.program, args, { cwd: dir, env, timeout: CLI_TIMEOUT_MS, signal }));
        } catch (error) {
          // A failed run exits 1 with its JSON error event on stdout.
          const e = error as { code?: unknown; killed?: boolean; stdout?: string; stderr?: string };
          const said = readOpenCodeEvents(e.stdout ?? "").error;
          throw failure(tool, signIn, { code: e.code, killed: e.killed, stderr: said ?? e.stderr }, signal);
        }
        const events = readOpenCodeEvents(stdout);
        if (events.error) throw failure(tool, signIn, { stderr: events.error }, signal);
        // No JSON events: its plain text, if any, is the answer.
        const text = events.events ? events.text : stdout.trim();
        if (!text && stderr.trim()) throw failure(tool, signIn, { stderr }, signal);
        if (!text) throw new ProviderError("unknown", `${tool} returned no text. Try again.`);
        return { text };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
