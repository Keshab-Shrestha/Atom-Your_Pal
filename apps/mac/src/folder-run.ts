// ADR-082, Task 3.11: what a worker in granted folders may touch. Every file tool's path is checked against the run's
// folders; every command is classified in code; risky ones ask Keshab on Pal's approval card (no answer is a no).

import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { FilePermissionScope } from "@ark/memory";
import type { FileApproval } from "./computer-bridge.ts";
import { DENY_READ_DIRS, WRITE_TOOLS, classifyCommand, isPushCommand, expandHome, floorProblem, folderForTask, hasGitPart, isInside, isSecretLike, pathProblem, realish, toolPaths } from "@ark/helpers";

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
  /** 2026-11-02: pushes the task's own branch from `cwd` outside the sandbox (which has no network) and says what happened. With it, an agent's
   *  `git push` asks Keshab instead of being refused. */
  push?(cwd: string): Promise<string>;
  /** The task's own folders (a project's folder, a git worktree): writes inside them are free (git or the checkpoints keep the undo). May be empty. */
  roots: string[];
  /** Explicit chat opt-in, rechecked at each call. Skips routine overwrite/command cards, never path/secret/undo checks. */
  fullAccess?(): boolean;
  /** The task read web text (ADR-123): a command outside the sandbox then asks even in Full access, as an MCP call does. */
  tainted?(): boolean;
  /** ADR-122: kept by the caller across the task's calls. A fresh one per call asks for every overwrite. */
  memory?: FolderMemory;
  cwd: string;
  /** The worker's name, for the approval card. */
  name: string;
  approve(request: { summary: string; reason: string }): Promise<boolean>;
  approveFile?(request: { summary: string; reason: string }): Promise<FileApproval>;
  permissions?: FilePermissionScope;
  /** Rechecked after awaiting approval, before a continuing grant or checkpoint is written. */
  cancelled?(): boolean;
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

/** True when an allowed Bash call runs outside the sandbox (2026-11-02): its command needs it, or the agent asked for it. */
export function runsOutsideSandbox(command: string, input: Record<string, unknown>): boolean {
  const verdict = classifyCommand(command);
  return input.dangerouslyDisableSandbox === true || (verdict.verdict === "ask" && verdict.outside === true);
}

/** The name `folderCheck` gets for the trash_file tool (2026-11-01). */
export const TRASH_CALL = "Trash";

/** The `check` a file run's tool calls go through: why a call is refused, or undefined to allow it. */
export function folderCheck(options: FolderCheckOptions) {
  const roots = options.roots.map((r) => realish(r));
  const home = options.home ?? homedir();
  const say = (tool: string, verdict: "allowed" | "refused" | "asked" | "declined") => options.onCheck?.({ tool, verdict });
  return async (name: string, input: Record<string, unknown>): Promise<string | undefined> => {
    const stopped = "The task was stopped. No further file operation or permission is allowed.";
    if (options.cancelled?.()) return stopped;
    if (name === "Bash") {
      const command = typeof input.command === "string" ? input.command : "";
      if (options.push && isPushCommand(command)) {
        // The sandbox has no network, so the command itself could never push: on Allow, ARK pushes the task's branch (origin only, never forced).
        if (!options.fullAccess?.()) {
          say(name, "asked");
          const ok = await options.approve({ summary: `${options.name} wants to push its task branch to origin`, reason: `Command: ${oneLine(command, 120)}. ARK pushes only the task's own branch, to origin, never forced.` });
          if (options.cancelled?.()) return stopped;
          if (!ok) return say(name, "declined"), "Keshab did not allow the push (he said no, or the card expired with no answer). Leave the work on its branch and say in the report that it is ready to push.";
        }
        try {
          return say(name, "refused"), `${await options.push(options.cwd)} Do not run git push yourself.`;
        } catch (error) {
          return say(name, "refused"), `ARK could not push: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      const verdict = classifyCommand(command);
      if (verdict.verdict === "refuse") return say(name, "refused"), verdict.reason;
      // 2026-11-02: an agent may ask to leave the sandbox itself (dangerouslyDisableSandbox), like Claude Code; that asks too.
      const outside = runsOutsideSandbox(command, input);
      if ((verdict.verdict === "ask" || outside) && (!options.fullAccess?.() || (outside && options.tainted?.()))) {
        say(name, "asked");
        const why = verdict.verdict === "ask" ? `This command ${verdict.reason}.` : "The agent asked to run it outside the sandbox.";
        const ok = await options.approve({ summary: `${options.name} wants to run: ${oneLine(command, 120)}`, reason: outside ? `${why} It runs outside the sandbox: it can use the network and change files anywhere you can.` : why });
        if (options.cancelled?.()) return stopped;
        if (!ok) return say(name, "declined"), "Keshab did not allow this command (he said no, or the card expired with no answer). Do the job without it, or say in the report what is needed.";
      }
      return say(name, "allowed"), undefined;
    }
    // 2026-11-01 (Keshab: "ask and give any permission, like Claude Code"): `Trash` is the trash_file tool, a write that removes a file.
    const trashing = name === TRASH_CALL;
    const writing = WRITE_TOOLS.includes(name) || trashing;
    // "~/x" is the home folder's x, as a shell reads it: expanded here, before every check, so it cannot pass as a path inside the task's folder.
    const paths = (trashing ? (typeof input.path === "string" && input.path ? [input.path] : []) : toolPaths(name, input)).map((p) => expandHome(p, home));
    if (trashing && !paths.length) return say(name, "refused"), "Name the file or folder to move to the Trash.";
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
      if (/[$`]/.test(p)) return say(name, "refused"), "A path with $ or a backtick in it cannot be checked, so it is not used. Write the whole path.";
      const target = realish(isAbsolute(p) ? p : resolve(options.cwd, p));
      if ((name === "Glob" || name === "Grep") && target === realish(home)) return say(name, "refused"), "Search inside a folder, not the whole home folder.";
      // ADR-122's floor and the secret checks (2026-10-15) used to refuse. Since 2026-11-01 they ask, with the exact path: Allow can cover the
      // rest of the chat, and Full access skips the question.
      const problem = floorProblem(home, roots, options.cwd, p, writing)
        ?? (isSecretLike(target, home) || isSecretLike(resolve(options.cwd, p), home) ? "It is a secret file or a key folder." : undefined)
        ?? (name === "Read" && holdsSecret(target) ? "It holds a secret (an API key, a token or a private key)." : undefined);
      if (!problem || options.fullAccess?.() || options.permissions?.has(target) || options.memory?.approved.has(target)) continue;
      say(name, "asked");
      const request = { summary: `${options.name} wants to ${writing ? "change" : "read"} a protected file: ${shortPath(target, home)}`, reason: `${problem} ${name} ${shortPath(target, home)}.` };
      const ok = options.approveFile ? await options.approveFile(request) : await options.approve(request);
      if (options.cancelled?.()) return stopped;
      if (!ok) return say(name, "declined"), "Keshab did not allow this file (he said no, or the card expired with no answer). Do the job without it, or say in the report what is needed.";
      if (ok === "chat" && options.permissions) options.permissions.grant(target);
      else options.memory?.approved.add(target);
    }
    if (trashing) {
      // Every delete asks (once per call), unless the chat is in Full access. The tool moves the item to the macOS Trash.
      const target = realish(isAbsolute(paths[0]!) ? paths[0]! : resolve(options.cwd, paths[0]!));
      if (!options.fullAccess?.()) {
        say(name, "asked");
        const ok = await options.approve({ summary: `${options.name} wants to move ${shortPath(target, home)} to the Trash`, reason: "You can put it back from the Trash in Finder." });
        if (options.cancelled?.()) return stopped;
        if (!ok) return say(name, "declined"), "Keshab did not allow this delete (he said no, or the card expired with no answer). Leave the file, or say in the report what should go.";
      }
      return say(name, "allowed"), undefined;
    }
    if (writing) {
      // ADR-123: a new file is free; an edit or overwrite of a file that exists asks Keshab once per file. Inside the task's own folders it is free
      // (git or the checkpoints undo it). More than MAX_OUTSIDE_WRITES files outside them asks again.
      const memory = options.memory ?? newFolderMemory();
      for (const p of paths) {
        const real = realish(isAbsolute(p) ? p : resolve(options.cwd, p));
        if (roots.some((r) => isInside(r, real))) continue;
        const asks: string[] = [];
        if (!options.fullAccess?.() && existsSync(real) && !memory.approved.has(real) && !options.permissions?.has(real)) asks.push(`change the file ${shortPath(real, home)}`);
        if (!memory.written.has(real) && memory.written.size >= MAX_OUTSIDE_WRITES) asks.push(`change more than ${MAX_OUTSIDE_WRITES} files outside its own folder`);
        if (asks.length) {
          say(name, "asked");
          const request = { summary: `${options.name} wants to ${asks[0]}`, reason: `${name} ${asks.join(" and ")}. ${preview(name, input)} A copy of the file is kept so you can undo it.`.replace(/\s+/g, " ") };
          // A continuing grant applies to this exact canonical file only. The floor and secret checks already ran.
          const canRemember = asks.length === 1 && memory.written.size < MAX_OUTSIDE_WRITES && options.permissions && options.approveFile;
          const ok = canRemember ? await options.approveFile!(request) : await options.approve(request);
          if (options.cancelled?.()) return stopped;
          if (!ok) return say(name, "declined"), "Keshab did not allow this change (he said no, or the card expired with no answer). Do the job without it, or say in the report what is needed.";
          if (ok === "chat") options.permissions!.grant(real);
          if (ok !== "chat") memory.approved.add(real);
        }
        memory.written.add(real);
      }
    }
    if (options.cancelled?.()) return stopped;
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
 * ADR-090: a file worker with no folder asks on Pal's card for the one its task names (else ~/Documents/ARK). Allowed:
 * ARK makes the folder and grants it, and the worker's folders come back. Refused or no answer in `waitMs`: an error
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
        reason: `Let ${name} read, write, copy and edit files in ${shown}? ARK makes the folder if it is missing. Change it on ${name}'s page.`,
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
