// ADR-082, Task 3.11: what a worker in granted folders may touch. Every file tool's path is checked against the run's
// folders; every command is classified in code; risky ones ask Keshab on Pal's approval card (no answer is a no).

import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { DENY_READ_DIRS, WRITE_TOOLS, classifyCommand, folderForTask, isInside, isSecretLike, pathProblem, realish, toolPaths } from "@atom/helpers";

/** Never readable by sandboxed commands: keys, tokens and other apps' secrets. */
export function denyRead(home = homedir()): string[] {
  return DENY_READ_DIRS.map((p) => join(home, p));
}

export interface FolderCheckOptions {
  /** The run's folders: the work folder and the worker's other grants. */
  roots: string[];
  cwd: string;
  /** The worker's name, for the approval card. */
  name: string;
  approve(request: { summary: string; reason: string }): Promise<boolean>;
  /** For the log: the tool and the verdict, never paths or command text. */
  onCheck?(event: { tool: string; verdict: "allowed" | "refused" | "asked" | "declined" }): void;
  /**
   * B3.4: called after the checks pass, for a tool that changes files (also a sub-agent's call), with the absolute
   * paths it names, before it runs. A throw never fails the run: it goes to `onBeforeError` (the tool's name only).
   */
  before?(tool: string, paths: string[]): void;
  onBeforeError?(event: { tool: string }): void;
}

const oneLine = (s: string, max: number) => (s.replace(/\s+/g, " ").trim().length > max ? `${s.replace(/\s+/g, " ").trim().slice(0, max - 1)}…` : s.replace(/\s+/g, " ").trim());

/** The `check` a file run's tool calls go through: why a call is refused, or undefined to allow it. */
export function folderCheck(options: FolderCheckOptions) {
  const roots = options.roots.map((r) => realish(r));
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
    const paths = toolPaths(name, input);
    for (const p of paths) {
      const problem = pathProblem(roots, options.cwd, p, WRITE_TOOLS.includes(name));
      if (problem) return say(name, "refused"), problem;
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

/**
 * ADR-090: a file worker with no folder asks on Pal's card for the one its task names (else ~/Documents/ATOM). Allowed:
 * ATOM makes the folder and grants it, and the worker's folders come back. Refused (or no answer): a clear error.
 */
export async function askForFolder(options: {
  task: string;
  name: string;
  home: string;
  approve(request: { summary: string; reason: string }): Promise<boolean>;
  /** Grants the folder (the store checks it) and returns the worker's folders. */
  grant(folder: string): string[];
  onAnswer?(allowed: boolean): void;
}): Promise<string[]> {
  const { task, name, home } = options;
  const folder = folderForTask(task, home);
  const shown = folder.startsWith(home) ? `~${folder.slice(home.length)}` : folder;
  const allowed = await options.approve({
    summary: `${name} needs a folder to save files in`,
    reason: `Let ${name} read, write, copy and edit files in ${shown}? ATOM makes the folder if it is missing. Change it on ${name}'s page.`,
  });
  options.onAnswer?.(allowed);
  if (!allowed) throw new Error(`${name} needs a folder to save files in, and none was allowed. Grant one on ${name}'s page, then retry.`);
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
export function projectReadCheck(roots: readonly string[], name: string, options: { home?: string; onCheck?(event: { tool: string; verdict: "allowed" | "refused" }): void } = {}) {
  const home = options.home ?? homedir();
  const real = roots.map((r) => realish(r));
  const cwd = real[0] ?? "/";
  const denied = denyRead(realish(home));
  const decide = (tool: string, input: Record<string, unknown>): string | undefined => {
    if (!PROJECT_READ_TOOLS.includes(tool)) return `A project chat only reads files. To change files, hand the work to ${name}.`;
    for (const key of ["pattern", "glob"]) {
      const value = input[key];
      if (typeof value !== "string") continue;
      if (hasDotDot(value)) return "A pattern with .. is not allowed in a project chat.";
      if (value.split(/[\\/]/).includes(".git")) return "Git's own files are not read in a project chat.";
    }
    const paths = toolPaths(tool, input);
    if (tool === "Read" && !paths.length) return "Read needs the path of a file in the project.";
    for (const p of paths) {
      const problem = pathProblem(real, cwd, p, false);
      if (problem) return problem;
      const target = realish(isAbsolute(p) ? p : resolve(cwd, p));
      if (target.split(sep).includes(".git")) return "Git's own files are not read in a project chat.";
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
      if (info.size > PROJECT_FILE_BYTES) return "That file is over 2 MB, too big to read into a chat.";
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
