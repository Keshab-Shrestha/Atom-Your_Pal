// ADR-269: the AI programs on this Mac, found live. A registry (data) says how to find each program; a scan finds them,
// reads each version cheaply and looks for a sign-in file by its name only. ARK scans at start, every 10 minutes and on
// demand. Keshab chooses which ready programs ARK may use; a program switched off leaves the model picker.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { findProgram, isLlmProvider, type Logger } from "@ark/shared";
import type { ScanDeps } from "./ai-tools.ts";

export type AiProgramStatus = "ready" | "found" | "local-model";

export interface AiProgramItem {
  id: string;
  name: string;
  found: boolean;
  version?: string;
  /** Display only: the home folder is shown as "~". */
  path?: string;
  /** ready: ARK has a chat adapter; found: no adapter yet; local-model: ARK does not use local models (CLAUDE.md §11). */
  status: AiProgramStatus;
  /** True when the program's own sign-in file is there (its contents are never read); absent when unknown. */
  signedIn?: boolean;
  provider?: string;
  /** Keshab lets ARK use it. Only a ready program can be allowed. */
  allowed: boolean;
  note?: string;
}

export interface AiProgramsEvent { type: "ai.programs"; programs: AiProgramItem[]; scannedAt: string }

interface ProgramSpec {
  id: string;
  name: string;
  /** Program names looked for on PATH and in the usual folders. */
  bins: string[];
  /** The ARK_*_PATH that wins, as for the provider's own finder. */
  envVar?: string;
  /** App bundles looked for in /Applications and ~/Applications. */
  apps?: string[];
  /** The program's own sign-in files ("~/" is the home folder). Only their existence is checked. */
  signIn?: string[];
  /** The gateway provider id; the program is ready when the gateway has this provider. */
  provider?: string;
  local?: true;
}

/** Binary names are checked against each program's own docs (ADR-269). */
export const AI_PROGRAMS: readonly ProgramSpec[] = [
  { id: "claude-code", name: "Claude Code", bins: ["claude"], envVar: "ARK_CLAUDE_PATH", provider: "claude-plan" }, // macOS keeps its sign-in in the Keychain
  { id: "codex", name: "Codex", bins: ["codex"], envVar: "ARK_CODEX_PATH", signIn: ["~/.codex/auth.json"], provider: "codex" },
  { id: "gemini-cli", name: "Gemini CLI", bins: ["gemini"], envVar: "ARK_GEMINI_PATH", signIn: ["~/.gemini/oauth_creds.json"], provider: "gemini-cli" },
  { id: "copilot", name: "GitHub Copilot CLI", bins: ["copilot"], provider: "copilot" },
  { id: "opencode", name: "OpenCode", bins: ["opencode"], signIn: ["~/.local/share/opencode/auth.json"], provider: "opencode" },
  { id: "cursor-agent", name: "Cursor Agent", bins: ["cursor-agent"], apps: ["Cursor.app"] }, // not "agent": other CLIs use that name
  { id: "aider", name: "Aider", bins: ["aider"] },
  { id: "qwen", name: "Qwen Code", bins: ["qwen"] },
  { id: "goose", name: "Goose", bins: ["goose"], apps: ["Goose.app"] },
  { id: "amp", name: "Amp", bins: ["amp"] },
  { id: "crush", name: "Crush", bins: ["crush"] },
  { id: "kiro", name: "Kiro", bins: ["kiro-cli"], apps: ["Kiro.app"] },
  { id: "ollama", name: "Ollama", bins: ["ollama"], envVar: "ARK_OLLAMA_PATH", apps: ["Ollama.app"], local: true },
  { id: "lm-studio", name: "LM Studio", bins: ["lms"], apps: ["LM Studio.app"], local: true },
];

/** Folders looked in besides PATH (findProgram adds ~/.local/bin, /opt/homebrew/bin and /usr/local/bin). */
const EXTRA_DIRS = ["~/.npm-global/bin", "~/.bun/bin", "~/.cargo/bin", "~/.opencode/bin", "~/.lmstudio/bin"];
/** The old `gh copilot` extension: noted, never used. */
const GH_COPILOT = "~/.local/share/gh/extensions/gh-copilot";

export const VERSION_TIMEOUT_MS = 3_000;
export const SCAN_BUDGET_MS = 8_000;
export const SCAN_EVERY_MS = 10 * 60_000;

/** `--version` and friends: 3 s at most, stdin closed so nothing can wait for input. */
export const defaultProgramDeps = (): ScanDeps => ({
  env: process.env,
  exists: (path) => existsSync(path),
  run: (program, args) =>
    new Promise((resolve, reject) => {
      const child = execFile(program, args, { timeout: VERSION_TIMEOUT_MS, killSignal: "SIGKILL", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NO_COLOR: "1" } /* security review: a found program never sees ARK's keys */ }, (error, stdout, stderr) =>
        error ? reject(error) : resolve(String(stdout).trim() || String(stderr)));
      child.stdin?.end();
    }),
  home: homedir(),
});

const versionOf = (said: string) => /\d+\.\d+[\w.+-]*/.exec(said.slice(0, 300))?.[0];

/** One program: where it is, its version (undefined when it did not answer before `deadline`), its sign-in hint. */
async function findOne(spec: ProgramSpec, deps: ScanDeps, deadline: Promise<undefined>): Promise<Omit<AiProgramItem, "allowed" | "status">> {
  const { env, exists, home } = deps;
  const expand = (p: string) => (p.startsWith("~/") ? `${home}${p.slice(1)}` : p);
  const search = { ...env, PATH: [env.PATH ?? "", ...EXTRA_DIRS.map(expand)].filter(Boolean).join(":") };
  const bin = spec.bins.map((name) => findProgram(name, spec.envVar ?? "", search, exists, home)).find(Boolean);
  const app = bin ? undefined : (spec.apps ?? []).flatMap((a) => [`/Applications/${a}`, `${home}/Applications/${a}`]).find(exists);
  const path = bin ?? app;
  const base = { id: spec.id, name: spec.name, found: Boolean(path), ...(spec.provider ? { provider: spec.provider } : {}) };
  if (!path) return base;
  const asked = bin ? deps.run(bin, ["--version"]) : deps.run("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", `${app}/Contents/Info.plist`]);
  const version = await Promise.race([asked.then(versionOf, () => undefined), deadline]);
  const signedIn = spec.signIn?.some((file) => exists(expand(file))) ? true : undefined;
  const shown = path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  return { ...base, path: shown, ...(version ? { version } : {}), ...(signedIn ? { signedIn } : {}) };
}

export type ScannedProgram = Omit<AiProgramItem, "allowed" | "status">;

/** Every program in the registry, found or not. Versions not back within `budgetMs` are left out; the scan never waits longer. */
export async function scanAiPrograms(deps: ScanDeps = defaultProgramDeps(), budgetMs = SCAN_BUDGET_MS): Promise<ScannedProgram[]> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<undefined>((resolve) => { timer = setTimeout(resolve, budgetMs, undefined); });
  try {
    const found = await Promise.all(AI_PROGRAMS.map((spec) => findOne(spec, deps, deadline)));
    const ghCopilot = deps.exists(`${deps.home}${GH_COPILOT.slice(1)}`);
    return found.map((p) => (p.id === "copilot" && !p.found && ghCopilot ? { ...p, note: "The old `gh copilot` extension is here. Install the Copilot CLI (`copilot`) for chat." } : p));
  } finally {
    clearTimeout(timer);
  }
}

/** ready, found or local-model, from the registry and the providers the gateway has. */
export function programStatus(spec: Pick<ProgramSpec, "provider" | "local">, isProvider: (id: string) => boolean = isLlmProvider): AiProgramStatus {
  if (spec.local) return "local-model";
  return spec.provider && isProvider(spec.provider) ? "ready" : "found";
}

const NOTES: Record<AiProgramStatus, string> = {
  ready: "ARK can chat with it",
  found: "Found, not connected to ARK yet",
  "local-model": "Runs local models: ARK does not use them",
};

export interface AiPrograms {
  /** Scans now, or joins the scan already running. `changed` is false when the list is the same as last time. */
  scan(): Promise<{ event: AiProgramsEvent; changed: boolean }>;
  /** The last scan with the current choices; undefined before the first scan. */
  event(): AiProgramsEvent | undefined;
  setAllowed(id: string, allowed: boolean): { ok: true } | { error: string };
  /** Provider ids of the programs switched off: the model picker leaves them out. */
  blockedProviders(): string[];
}

export interface AiProgramsOptions {
  /** The choices file, next to config/island.json. */
  path: string;
  deps?: () => ScanDeps;
  isProvider?: (id: string) => boolean;
  budgetMs?: number;
  now?: () => Date;
  log?: Pick<Logger, "info" | "warn">;
}

function readDisallowed(path: string, log: AiProgramsOptions["log"]): Set<string> {
  if (!existsSync(path)) return new Set();
  try {
    const value = (JSON.parse(readFileSync(path, "utf8")) as { disallowed?: unknown } | null)?.disallowed;
    if (Array.isArray(value) && value.every((id) => typeof id === "string")) return new Set(value);
  } catch { /* reported below */ }
  log?.warn("ai_programs.settings_ignored", { reason: 'expected {"disallowed":["id",…]}' });
  return new Set();
}

export function createAiPrograms(options: AiProgramsOptions): AiPrograms {
  const { path, log } = options;
  const isProvider = options.isProvider ?? isLlmProvider;
  const now = options.now ?? (() => new Date());
  let disallowed = readDisallowed(path, log);
  let last: { programs: ScannedProgram[]; scannedAt: string } | undefined;
  let running: Promise<{ event: AiProgramsEvent; changed: boolean }> | undefined;
  const spec = (id: string) => AI_PROGRAMS.find((p) => p.id === id);

  const event = (): AiProgramsEvent | undefined => last && {
    type: "ai.programs",
    scannedAt: last.scannedAt,
    programs: last.programs.map((p) => {
      const status = programStatus(spec(p.id)!, isProvider);
      return { ...p, status, allowed: status === "ready" && !disallowed.has(p.id), ...(p.note || !p.found ? {} : { note: NOTES[status] }) };
    }),
  };

  async function run() {
    const programs = await scanAiPrograms(options.deps?.() ?? defaultProgramDeps(), options.budgetMs);
    const changed = JSON.stringify(programs) !== JSON.stringify(last?.programs);
    last = { programs, scannedAt: now().toISOString() };
    if (changed) log?.info("ai_programs.scan", { found: programs.filter((p) => p.found).map((p) => p.id).join(",") });
    return { event: event()!, changed };
  }

  return {
    scan: () => (running ??= run().finally(() => { running = undefined; })),
    event,
    setAllowed(id, allowed) {
      const found = spec(id);
      if (!found) return { error: `Unknown AI program "${id.slice(0, 40)}".` };
      if (programStatus(found, isProvider) !== "ready") return { error: `${found.name} is not connected to ARK, so it cannot be switched on.` };
      const next = new Set(disallowed);
      if (allowed) next.delete(id); else next.add(id);
      try {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.tmp`;
        writeFileSync(temporary, `${JSON.stringify({ disallowed: [...next].sort() }, null, 2)}\n`);
        renameSync(temporary, path);
      } catch (error) {
        log?.warn("ai_programs.save_failed", { message: error instanceof Error ? error.message : String(error) });
        return { error: "The choice could not be saved. Try again." };
      }
      disallowed = next;
      log?.info("ai_programs.allow", { id, allowed });
      return { ok: true };
    },
    blockedProviders: () => AI_PROGRAMS.filter((p) => p.provider && disallowed.has(p.id)).map((p) => p.provider!),
  };
}
