import { lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { HelperError } from "./jobs.ts";

// ADR-082, Task 3.11: folder grants and the checks every file tool and command passes, in code. A soul, a task or a
// page can never widen them.

export const MAX_GRANTS = 8;

/** Folders inside the home folder that hold keys, tokens and other apps' secrets (never readable by commands, never checkpointed). */
export const DENY_READ_DIRS = [".ssh", ".aws", ".gnupg", ".config", ".netrc", ".npmrc", ".docker", ".kube", ".azure", ".claude", ".codex", ".hermes", "Library/Keychains", "Library/Cookies"];

/** The most links followed when a path ends in links that point at files not made yet. */
const MAX_LINK_HOPS = 32;

/**
 * The real path of `p`, or of its nearest existing ancestor joined with the rest (for a file not written yet). A link whose target does
 * not exist yet (a dangling link) is followed to where it points: `realpathSync` throws for it, and the walk up used to treat it as a plain
 * missing name inside its folder, so a write through `proj/x -> ~/.ssh/authorized_keys` looked like a write inside `proj` (code check, 2026-10-16).
 */
export function realish(p: string, hops = 0): string {
  let head = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return [realpathSync(head), ...tail].join(sep);
    } catch {
      try {
        if (hops < MAX_LINK_HOPS && lstatSync(head).isSymbolicLink()) {
          return realish([resolve(dirname(head), readlinkSync(head)), ...tail].join(sep), hops + 1);
        }
      } catch {
        // not a link, or it cannot be read: treat it as a missing name, as before
      }
      const parent = dirname(head);
      if (parent === head) return resolve(p);
      tail.unshift(head.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      head = parent;
    }
  }
}

/** Does the path have a folder or file named `.git`, in any case? macOS ignores case, so `.GIT/hooks` is git's own folder too. */
export const hasGitPart = (p: string) => p.split(/[\\/]/).some((part) => part.toLowerCase() === ".git");

export const isInside = (root: string, p: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * A folder Keshab may grant, as its real path. Only inside the home folder (never the home folder itself, `~/Library`
 * or any hidden folder such as `~/.ssh`) or on an external drive under `/Volumes`. Throws HelperError with why not.
 */
export function checkGrant(path: string, home: string): string {
  if (!isAbsolute(path)) throw new HelperError("Choose a folder by its full path.");
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    throw new HelperError("That folder does not exist.");
  }
  if (!statSync(real).isDirectory()) throw new HelperError("That is a file, not a folder.");
  const homeReal = realpathSync(home);
  if (real === homeReal) throw new HelperError("The whole home folder cannot be granted. Choose a project folder inside it.");
  if (isInside(homeReal, real)) {
    const parts = real.slice(homeReal.length + 1).split(sep);
    if (parts[0]?.toLowerCase() === "library") throw new HelperError("~/Library holds apps' data and cannot be granted."); // any case: macOS ignores it
    if (parts.some((part) => part.startsWith("."))) throw new HelperError("Hidden folders (such as ~/.ssh) hold keys and settings and cannot be granted.");
    return real;
  }
  if (/^\/Volumes\/[^/]+\/.+/.test(real)) return real;
  throw new HelperError("Only folders inside your home folder or on an external drive can be granted.");
}

/** Words in a task that mean files are to be saved, so a file worker without a folder asks for one. */
/**
 * ADR-090: the folder to offer a file worker that has none: a path the task names inside the home folder ("~/Notes",
 * "/Users/me/Notes"), a folder it names ("a folder named ZenoDoc", in Documents or on the Desktop if it says so,
 * else in the home folder), or ~/Documents/ATOM. Never the home folder itself, ~/Library or a hidden folder.
 */
export function folderForTask(task: string, home: string): string {
  const fallback = join(home, "Documents", "ATOM");
  const allowed = (p: string) => {
    const real = resolve(p);
    if (!isInside(home, real) || real === resolve(home)) return false;
    const parts = real.slice(resolve(home).length + 1).split(sep);
    return parts[0]?.toLowerCase() !== "library" && !parts.some((part) => part.startsWith("."));
  };
  const tidy = (p: string) => p.replace(/[.,;:!?)"'’]+$/, "");
  const path = task.match(/(?:^|\s)(~\/[^\s"']+|\/Users\/[^\s"']+)/)?.[1];
  if (path) {
    const full = tidy(path.startsWith("~/") ? join(home, path.slice(2)) : path);
    if (allowed(full)) return full;
  }
  const named = task.match(/\bfolder (?:named|called) ["'“]?([\w][\w .-]{0,60}?)["'”]?(?=[\s,.;:!?]|$)/i)?.[1];
  if (named && !named.includes("..")) {
    const base = /\bdesktop\b/i.test(task) ? join(home, "Desktop") : /\bdocuments\b/i.test(task) ? join(home, "Documents") : home;
    const full = join(base, tidy(named.trim()));
    if (allowed(full)) return full;
  }
  return fallback;
}

/**
 * Why a file tool's path is refused, or undefined when it is inside one of the run's folders. A change inside a `.git`
 * folder or file is refused too: git's own data is ATOM's to write (it commits the work), never the worker's.
 */
export function pathProblem(roots: readonly string[], cwd: string, p: string, writing = false): string | undefined {
  const real = realish(isAbsolute(p) ? p : resolve(cwd, p));
  if (!roots.some((root) => isInside(root, real))) return `${p} is outside the folders this task may use.`;
  if (writing && hasGitPart(real)) return "Git's own files are not changed by hand: ATOM commits the work.";
  return undefined;
}

/** File tools that change files. */
export const WRITE_TOOLS: readonly string[] = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

/** The paths a file tool's input names, for checking. */
export function toolPaths(name: string, input: Record<string, unknown>): string[] {
  const str = (k: string) => (typeof input[k] === "string" && input[k] ? [input[k] as string] : []);
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return str("file_path");
    case "NotebookEdit":
      return str("notebook_path");
    case "Glob":
    case "Grep":
      // A pattern may itself be an absolute path ("/etc/**"): checked too.
      return [...str("path"), ...str("pattern").filter((x) => isAbsolute(x)).map((x) => x.replace(/[*?[{].*$/, "") || "/")];
    default:
      return [];
  }
}

export type CommandVerdict = { verdict: "allow" } | { verdict: "ask"; reason: string } | { verdict: "refuse"; reason: string };

// git's own options may stand between "git" and the subcommand ("git -C . push", "git -c k=v push", "git --git-dir=x push"): the rules below read
// through them (code check, 2026-10-16). A newline, `env`, `xargs` and `command` can stand in front of sudo.
const GIT = String.raw`\bgit(?:\s+(?:-[cC]\s+\S+|--[\w-]+(?:=\S+)?|-[a-zA-Z]))*\s+`;
const REFUSED: [RegExp, string][] = [
  [new RegExp(`${GIT}push\\b`), "Pushing is never done: the work stays on its branch on this Mac."],
  [new RegExp(`${GIT}remote\\s+(?:add|set-url|rename|remove|rm)\\b`), "Changing the repository's remotes is not allowed."],
  [new RegExp(`${GIT}(?:checkout|switch)(?:\\s+-\\S+)*\\s+(?:main|master)\\b|${GIT}(?:reset\\s+--hard|rebase|filter-branch|update-ref)\\b`), "Only the task's own branch is touched."],
  [/(?:^|[;&|(\n]\s*|\b(?:env|xargs|command|exec|nohup|time)\s+)(?:sudo|doas|su)\b/, "Nothing runs as an administrator."],
  [/\bsecurity\s+(?:find|dump|export)|\bdefaults\s+write\b|\blaunchctl\b|\bosascript\b/, "System settings, keychains and other apps are out of reach."],
  [/\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\brsync\b.*:|\bnc\b/, "Commands have no network."],
];
const ASKED: [RegExp, string][] = [
  [/\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/, "deletes folders"],
  [/\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+install\b|\bgem\s+install\b/, "installs software"],
  [new RegExp(`${GIT}(?:clean|branch\\s+(?:-[dD]|--delete))\\b`), "deletes files or branches"],
];

/** A sandboxed command's fate, in code: some are never run, some ask Keshab first, the rest run. */
export function classifyCommand(command: string): CommandVerdict {
  for (const [re, reason] of REFUSED) if (re.test(command)) return { verdict: "refuse", reason };
  for (const [re, reason] of ASKED) if (re.test(command)) return { verdict: "ask", reason };
  return { verdict: "allow" };
}
