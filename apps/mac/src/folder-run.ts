// ADR-082, Task 3.11: what a worker in granted folders may touch. Every file tool's path is checked against the run's
// folders; every command is classified in code; risky ones ask Keshab on Pal's approval card (no answer is a no).

import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { DENY_READ_DIRS, WRITE_TOOLS, classifyCommand, expandHome, floorProblem, folderForTask, hasGitPart, isInside, isSecretLike, pathProblem, realish, toolPaths } from "@atom/helpers";

/** Never readable by sandboxed commands: keys, tokens and other apps' secrets. */
export function denyRead(home = homedir()): string[] {
  return DENY_READ_DIRS.map((p) => join(home, p));
}

/** ADR-122: what one task has asked about and written outside its own folders, kept across its calls (a card is asked once per file). */
export interface FolderMemory {
  approved: Set<string>;
  written: Set<string>;
}
export const newFolderMemory = (): FolderMemory => ({ approved: new Set(), written: new Set() });
/** ADR-122: a task that changes more files than this outside its own folders asks once more. */
export const MAX_OUTSIDE_WRITES = 200;

export interface FolderCheckOptions {
  /** The task's own folders (a project's folder, a git worktree): writes inside them are free (git or the checkpoints keep the undo). May be empty. */
  roots: string[];
  /** ADR-122: kept by the caller across the task's calls. A fresh one per call asks for every overwrite. */
  memory?: FolderMemory;
  cwd: string;
  /** The worker's name, for the approval card. */
  name: string;
  approve(request: { summary: string; reason: string }): Promise<boolean>;
  /** Keshab's home folder, for the secret-folder check. Default: the real home. */
  home?: string;
  /** For the log: the tool and the verdict, never paths or command text. */
  onCheck?(event: { tool: string; verdict: "allowed" | "refused" | "asked" | "declined" }): void;
  /**
   * B3.4: called after the checks pass, for a tool that changes files (also a sub-agent's call), with the absolute
   * paths it names, before it runs. A throw never fails the run: it goes to `onBeforeError` (the tool's name only).
   */
  before?(tool: string, paths: string[]): void;
  onBeforeError?(event: { tool: string }): void;
}

/**
 * ADR-123: shapes of secrets (private-key blocks, API keys, cloud and chat tokens). A file that holds one is not read by an agent: the read result
 * cannot be edited afterwards, so the file is refused. A hex string of 64 characters is not on the list (hashes and lock files hold them).
 */
export const SECRET_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{20,}/,
  /\bnpm_[A-Za-z0-9]{30,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
  /\bya29\.[A-Za-z0-9_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // a JSON web token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, // a Telegram bot token
];
const SECRET_SCAN_BYTES = 1024 * 1024;
/** Does this file (its first megabyte) hold a secret shape? False for a missing file, a folder or an unreadable one. */
export function holdsSecret(path: string): boolean {
  let fd: number | undefined;
  try {
    if (!statSync(path).isFile()) return false;
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(SECRET_SCAN_BYTES);
    const n = readSync(fd, buffer, 0, SECRET_SCAN_BYTES, 0);
    const text = buffer.subarray(0, n).toString("latin1");
    return SECRET_SHAPES.some((re) => re.test(text));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** A few words of what a write or edit will do, for the approval card (no more than 160 characters of the file's own text). */
function preview(name: string, input: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const cut = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);
  if (name === "Write") return `New content starts: "${cut(str(input.content), 160)}"`;
  if (name === "Edit") return `Replace "${cut(str(input.old_string), 70)}" with "${cut(str(input.new_string), 70)}"`;
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    const first = (input.edits[0] ?? {}) as Record<string, unknown>;
    return `${input.edits.length} edits, the first: replace "${cut(str(first.old_string), 50)}" with "${cut(str(first.new_string), 50)}"`;
  }
  return "";
}

const shortPath = (real: string, home: string) => (isInside(realish(home), real) ? `~${real.slice(realish(home).length)}` : real);
const oneLine = (s: string, max: number) => (s.replace(/\s+/g, " ").trim().length > max ? `${s.replace(/\s+/g, " ").trim().slice(0, max - 1)}…` : s.replace(/\s+/g, " ").trim());

/** The `check` a file run's tool calls go through: why a call is refused, or undefined to allow it. */
export function folderCheck(options: FolderCheckOptions) {
  const roots = options.roots.map((r) => realish(r));
  const home = options.home ?? homedir();
  const say = (tool: string, verdict: "allowed" | "refused" | "asked" | "declined") => options.onCheck?.({ tool, verdict });
  return async (name: string, input: Record<string, unknown>): Promise<string | undefined> => {
    if (name === "Bash") {
      const command = typeof input.command === "string" ? input.command : "";
      const verdict = classifyCommand(command);
      if (verdict.verdict === "refuse") return say(name, "refused"), verdict.reason;
      if (verdict.verdict === "ask") {
        say(name, "asked");
        const ok = await options.approve({ summary: `${options.name} wants to run: ${oneLine(command, 120)}`, reason: `This command ${verdict.reason}.` });
        if (!ok) return say(name, "declined"), "Keshab did not allow this command. Do the job without it, or say in the report what is needed.";
      }
      return say(name, "allowed"), undefined;
    }
    const writing = WRITE_TOOLS.includes(name);
    // "~/x" is the home folder's x, as a shell reads it: expanded here, before every check, so it cannot pass as a path inside the task's folder.
    const paths = toolPaths(name, input).map((p) => expandHome(p, home));
    // A pattern may climb out of the folder or name a variable: never checked, so never used.
    for (const key of ["pattern", "glob"]) {
      const value = input[key];
      if (typeof value === "string" && (name === "Glob" || name === "Grep") && (value.split(/[\\/]/).includes("..") || value.startsWith("~") || /[$`]/.test(value))) {
        return say(name, "refused"), "A pattern with .., ~ or $ in it is not used. Search inside a folder with a plain pattern.";
      }
    }
    // Outside the task's own folders a Grep shows file names only: its lines would show the text of any file that is not hidden (an identity or bank
    // document, a file with keys) without the checks that Read makes.
    if (name === "Grep" && input.output_mode === "content" && !roots.some((r) => paths.some((p) => isInside(r, realish(isAbsolute(p) ? p : resolve(options.cwd, p)))))) {
      return say(name, "refused"), "Outside the task's own folder, Grep lists the matching files only (output_mode files_with_matches). Read the files you need.";
    }
    // A search with no path searches the working folder: never the whole home folder (it holds ~/Library and every hidden folder).
    if ((name === "Glob" || name === "Grep") && !paths.length && realish(options.cwd) === realish(home)) return say(name, "refused"), "Search inside a folder, not the whole home folder.";
    for (const p of paths) {
      // ADR-122: the same floor for every agent; no per-agent folders.
      const problem = floorProblem(home, roots, options.cwd, p, writing);
      if (problem) return say(name, "refused"), problem;
      const target = realish(isAbsolute(p) ? p : resolve(options.cwd, p));
      if ((name === "Glob" || name === "Grep") && target === realish(home)) return say(name, "refused"), "Search inside a folder, not the whole home folder.";
      // 2026-10-15 (security review): a folder that holds ATOM's own data (or any .env or key) let a folders agent read the API token and the databases.
      if (isSecretLike(target, home) || isSecretLike(resolve(options.cwd, p), home)) return say(name, "refused"), "Secret files and key folders are never opened by an agent.";
      if (name === "Read" && holdsSecret(target)) return say(name, "refused"), "This file holds a secret (an API key, a token or a private key), so an agent does not read it. Say in the report that you skipped it.";
    }
    if (writing) {
      // ADR-123: a new file is free; an edit or overwrite of a file that exists asks Keshab once per file. Inside the task's own folders it is free
      // (git or the checkpoints undo it). More than MAX_OUTSIDE_WRITES files outside them asks again.
      const memory = options.memory ?? newFolderMemory();
      for (const p of paths) {
        const real = realish(isAbsolute(p) ? p : resolve(options.cwd, p));
        if (roots.some((r) => isInside(r, real))) continue;
        const asks: string[] = [];
        if (existsSync(real) && !memory.approved.has(real)) asks.push(`change the file ${shortPath(real, home)}`);
        if (!memory.written.has(real) && memory.written.size >= MAX_OUTSIDE_WRITES) asks.push(`change more than ${MAX_OUTSIDE_WRITES} files outside its own folder`);
        if (asks.length) {
          say(name, "asked");
          const ok = await options.approve({ summary: `${options.name} wants to ${asks[0]}`, reason: `${name} ${asks.join(" and ")}. ${preview(name, input)} A copy of the file is kept so you can undo it.`.replace(/\s+/g, " ") });
          if (!ok) return say(name, "declined"), "Keshab did not allow this change. Do the job without it, or say in the report what is needed.";
          memory.approved.add(real);
        }
        memory.written.add(real);
      }
    }
    if (options.before && WRITE_TOOLS.includes(name)) {
      try {
        options.before(name, paths.map((p) => (isAbsolute(p) ? p : resolve(options.cwd, p))));
      } catch {
        options.onBeforeError?.({ tool: name });
      }
    }
    return say(name, "allowed"), undefined;
  };
}

/**
 * B3.4, ADR-101: the `before` of a run in folders: keeps each file's original before its first edit. A file inside the
 * run's git worktree is left to git. `keep` gets the run's folders and the path.
 */
export function checkpointBefore(options: { roots: string[]; tree?: string; keep(roots: string[], path: string): void }) {
  const tree = options.tree ? realish(options.tree) : undefined;
  return (_tool: string, paths: string[]) => {
    for (const p of paths) if (!(tree && isInside(tree, realish(p)))) options.keep(options.roots, p);
  };
}

/** A worker that needs a folder waits this long for the answer (the default wait for other questions is 60 s). */
export const FOLDER_WAIT_MS = 10 * 60_000;

/**
 * ADR-090: a file worker with no folder asks on Pal's card for the one its task names (else ~/Documents/ATOM). Allowed:
 * ATOM makes the folder and grants it, and the worker's folders come back. Refused or no answer in `waitMs`: an error
 * that says which one happened.
 */
export async function askForFolder(options: {
  task: string;
  name: string;
  home: string;
  approve(request: { summary: string; reason: string; timeoutMs: number }, signal: AbortSignal): Promise<boolean>;
  /** The job's own signal: stopping the job withdraws the question. */
  signal?: AbortSignal;
  waitMs?: number;
  /** Called when the question is asked, for the job's step line. */
  onWaiting?(): void;
  /** Grants the folder (the store checks it) and returns the worker's folders. */
  grant(folder: string): string[];
  onAnswer?(allowed: boolean, timedOut: boolean): void;
}): Promise<string[]> {
  const { task, name, home } = options;
  const folder = folderForTask(task, home);
  const shown = folder.startsWith(home) ? `~${folder.slice(home.length)}` : folder;
  const waitMs = options.waitMs ?? FOLDER_WAIT_MS;
  const timer = new AbortController();
  let timedOut = false;
  const wait = setTimeout(() => {
    timedOut = true;
    timer.abort();
  }, waitMs);
  options.onWaiting?.();
  let allowed: boolean;
  try {
    allowed = await options.approve(
      {
        // The folder is in the summary: the card and Telegram cut the reason short.
        summary: `${name} needs a folder to save files in: ${shown}`,
        reason: `Let ${name} read, write, copy and edit files in ${shown}? ATOM makes the folder if it is missing. Change it on ${name}'s page.`,
        timeoutMs: waitMs + 5_000, // a backstop: the timer above decides and says so
      },
      options.signal ? AbortSignal.any([options.signal, timer.signal]) : timer.signal,
    );
  } finally {
    clearTimeout(wait);
  }
  options.onAnswer?.(allowed, timedOut);
  if (!allowed) {
    const why = timedOut ? `You did not answer in ${Math.round(waitMs / 60_000)} minutes` : "You declined";
    throw new Error(`${why}: ${name} needs a folder to save files in, and none was allowed. Grant one on ${name}'s page, then retry.`);
  }
  mkdirSync(folder, { recursive: true });
  return options.grant(folder);
}

/** ADR-107: the only tools a project chat has: they read, never write. */
export const PROJECT_READ_TOOLS: readonly string[] = ["Read", "Glob", "Grep"];
/** ADR-107: a file bigger than this is never read into a chat. */
export const PROJECT_FILE_BYTES = 2 * 1024 * 1024;
/** A search that names no glob skips these (ripgrep's `!{...}` form), so a search never reads a key or git's own files. */
const SEARCH_SKIPS = "!{.git,.env*,*.pem,id_rsa*}";
const EXTENSION_GLOB = /^(\*\*\/)?\*\.(\w{1,8}|\{\w{1,8}(,\w{1,8})*\})$/;
const SECRETISH = /\.git\b|\.env|\.pem|id_rsa|\.ssh|\.aws|\.gnupg/i;
const hasDotDot = (text: string) => text.split(/[\\/]/).includes("..");

/**
 * ADR-107: the `check` of a project chat's Read, Glob and Grep, in code. The model proposes; this decides. The path is
 * inside the project's real folder (symlinks and .. resolved when the call is made), is no secret-like file, no key
 * folder and no git file, and a file is at most 2 MB. A pattern is never absolute outside the folder and never has `..`.
 * `onCheck` gets the tool and the verdict, never a path. `prepare` gives a search that names no glob the skips above.
 */
export function projectReadCheck(roots: readonly string[], name: string, options: { home?: string; maxBytes?: number; onCheck?(event: { tool: string; verdict: "allowed" | "refused" }): void } = {}) {
  const home = options.home ?? homedir();
  const maxBytes = options.maxBytes ?? PROJECT_FILE_BYTES;
  const real = roots.map((r) => realish(r));
  const cwd = real[0] ?? "/";
  const denied = denyRead(realish(home));
  const decide = (tool: string, input: Record<string, unknown>): string | undefined => {
    if (!PROJECT_READ_TOOLS.includes(tool)) return `A project chat only reads files. To change files, hand the work to ${name}.`;
    for (const key of ["pattern", "glob"]) {
      const value = input[key];
      if (typeof value !== "string") continue;
      if (hasDotDot(value)) return "A pattern with .. is not allowed in a project chat.";
      if (hasGitPart(value)) return "Git's own files are not read in a project chat.";
    }
    const paths = toolPaths(tool, input);
    if (tool === "Read" && !paths.length) return "Read needs the path of a file in the project.";
    for (const p of paths) {
      const problem = pathProblem(real, cwd, p, false);
      if (problem) return problem;
      const target = realish(isAbsolute(p) ? p : resolve(cwd, p));
      if (hasGitPart(target)) return "Git's own files are not read in a project chat.";
      if (isSecretLike(target, home) || isSecretLike(resolve(cwd, p), home) || denied.some((d) => isInside(d, target))) return "Secret files and key folders are never read in a project chat.";
    }
    if (tool === "Read") {
      const target = realish(isAbsolute(paths[0]!) ? paths[0]! : resolve(cwd, paths[0]!));
      let info;
      try {
        info = statSync(target);
      } catch {
        return undefined; // a missing file: Read itself says so
      }
      if (!info.isFile()) return "That is not a file. Use Glob to list a folder.";
      if (info.size > maxBytes) return `That file is over ${Math.round(maxBytes / 1024 / 1024)} MB, too big to read into a chat.`;
    }
    if (tool === "Grep" && typeof input.glob === "string" && (SECRETISH.test(input.glob) || !EXTENSION_GLOB.test(input.glob))) {
      return "Use a glob like *.ts for the file type, or search without a glob.";
    }
    return undefined;
  };
  const check = async (tool: string, input: Record<string, unknown>) => {
    const problem = decide(tool, input);
    options.onCheck?.({ tool, verdict: problem ? "refused" : "allowed" });
    return problem;
  };
  const prepare = (tool: string, input: Record<string, unknown>): Record<string, unknown> =>
    tool === "Grep" && typeof input.glob !== "string" ? { ...input, glob: SEARCH_SKIPS } : input;
  return Object.assign(check, { prepare });
}
