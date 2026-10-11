// ADR-093: the AI tools installed on this Mac, for Settings → AI model: each found or not, signed in or not (when the
// tool can say so without ZENO reading its login), and whether ZENO can run on it. Claude Code, Codex and the Gemini
// CLI are subscription tools ZENO can use; Ollama and LM Studio run local models, which ZENO's rules leave out
// (CLAUDE.md §11), so they are listed but not used.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLAUDE_PLAN, CODEX, GEMINI_CLI, findClaudeProgram, findProgram } from "@zeno/shared";

export interface AiToolItem {
  id: "claude-code" | "codex" | "gemini-cli" | "ollama" | "lm-studio";
  name: string;
  found: boolean;
  /** Undefined when the tool cannot be asked without reading its login. */
  signedIn?: boolean;
  /** The provider ZENO runs it as, when it can. */
  provider?: string;
  /** What it means for ZENO, in words. */
  note: string;
}

export interface ScanDeps {
  env: Record<string, string | undefined>;
  exists(path: string): boolean;
  /** Runs a program briefly; resolves with what it printed (stdout, else stderr), rejects on failure. */
  run(program: string, args: string[]): Promise<string>;
  home: string;
}

const STATUS_TIMEOUT_MS = 10_000;

export const defaultScanDeps = (): ScanDeps => ({
  env: process.env,
  exists: (path) => existsSync(path),
  run: (program, args) =>
    new Promise((resolve, reject) => {
      // Some tools (Codex) print their status on stderr: that is used when stdout is empty.
      execFile(program, args, { timeout: STATUS_TIMEOUT_MS, env: process.env }, (error, stdout, stderr) => (error ? reject(error) : resolve(String(stdout).trim() || String(stderr))));
    }),
  home: homedir(),
});

/** `claude auth status` prints JSON; only "loggedIn" is read. */
async function claudeSignedIn(program: string, deps: ScanDeps): Promise<boolean | undefined> {
  try {
    return (JSON.parse(await deps.run(program, ["auth", "status"])) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return undefined;
  }
}

/** `codex login status` says "Logged in …", and fails when no one is. */
async function codexSignedIn(program: string, deps: ScanDeps): Promise<boolean> {
  try {
    const said = await deps.run(program, ["login", "status"]);
    return /logged in/i.test(said) && !/not logged in/i.test(said);
  } catch {
    return false;
  }
}

/** Every AI tool ZENO knows to look for, found or not. */
export async function scanAiTools(deps: ScanDeps = defaultScanDeps()): Promise<AiToolItem[]> {
  const { env, exists, home } = deps;
  const claude = findClaudeProgram(env, exists, home);
  const codex = findProgram("codex", "ZENO_CODEX_PATH", env, exists, home);
  const gemini = findProgram("gemini", "ZENO_GEMINI_PATH", env, exists, home);
  const ollama = findProgram("ollama", "ZENO_OLLAMA_PATH", env, exists, home) ?? ["/Applications/Ollama.app"].find(exists);
  const lmStudio = ["/Applications/LM Studio.app", join(home, ".lmstudio/bin/lms")].find(exists);
  const [claudeIn, codexIn] = await Promise.all([claude ? claudeSignedIn(claude, deps) : undefined, codex ? codexSignedIn(codex, deps) : undefined]);
  // The Gemini CLI has no status command: its saved Google sign-in is looked for, never read.
  const geminiIn = gemini && exists(join(home, ".gemini/oauth_creds.json")) ? true : undefined;
  const signedNote = (signedIn: boolean | undefined, how: string) =>
    signedIn === false ? `Found, not signed in: ${how}` : signedIn ? "Signed in: ZENO can use it" : "Found: ZENO can use it once you have signed in";
  const with_ = (signedIn: boolean | undefined) => (signedIn === undefined ? {} : { signedIn });
  return [
    { id: "claude-code", name: "Claude Code", found: Boolean(claude), ...with_(claudeIn), provider: CLAUDE_PLAN,
      note: claude ? signedNote(claudeIn, "run `claude auth login`") : "Not found: install Claude Code to use your Claude plan" },
    { id: "codex", name: "Codex", found: Boolean(codex), ...with_(codexIn), provider: CODEX,
      note: codex ? `${signedNote(codexIn, "run `codex login`")} (chat only)` : "Not found: Codex comes with the ChatGPT app or its editor extension" },
    { id: "gemini-cli", name: "Gemini CLI", found: Boolean(gemini), ...with_(geminiIn), provider: GEMINI_CLI,
      note: gemini ? `${signedNote(geminiIn, "run `gemini` and sign in with Google")} (chat only)` : "Not found: install it with `brew install gemini-cli`" },
    { id: "ollama", name: "Ollama", found: Boolean(ollama), note: ollama ? "Found: local models are not used by ZENO" : "Not found" },
    { id: "lm-studio", name: "LM Studio", found: Boolean(lmStudio), note: lmStudio ? "Found: local models are not used by ZENO" : "Not found" },
  ];
}
