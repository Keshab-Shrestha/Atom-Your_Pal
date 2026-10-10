import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { HelperError } from "./jobs.ts";

// ADR-082, Task 3.11: folder grants and the checks every file tool and command passes, in code. A soul, a task or a
// page can never widen them.

/** Roles that work in granted folders (the coder, designer and documenter). */
export const FILE_ROLES: readonly string[] = ["coder", "designer", "documenter"];
export const MAX_GRANTS = 8;

/** The real path of `p`, or of its nearest existing ancestor joined with the rest (for a file not written yet). */
export function realish(p: string): string {
  let head = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return [realpathSync(head), ...tail].join(sep);
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolve(p);
      tail.unshift(head.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      head = parent;
    }
  }
}

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
    if (parts[0] === "Library") throw new HelperError("~/Library holds apps' data and cannot be granted.");
    if (parts.some((part) => part.startsWith("."))) throw new HelperError("Hidden folders (such as ~/.ssh) hold keys and settings and cannot be granted.");
    return real;
  }
  if (/^\/Volumes\/[^/]+\/.+/.test(real)) return real;
  throw new HelperError("Only folders inside your home folder or on an external drive can be granted.");
}

/**
 * Why a file tool's path is refused, or undefined when it is inside one of the run's folders. A change inside a `.git`
 * folder or file is refused too: git's own data is ZENO's to write (it commits the work), never the worker's.
 */
export function pathProblem(roots: readonly string[], cwd: string, p: string, writing = false): string | undefined {
  const real = realish(isAbsolute(p) ? p : resolve(cwd, p));
  if (!roots.some((root) => isInside(root, real))) return `${p} is outside the folders this task may use.`;
  if (writing && real.split(sep).includes(".git")) return "Git's own files are not changed by hand: ZENO commits the work.";
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

const REFUSED: [RegExp, string][] = [
  [/\bgit\s+push\b/, "Pushing is never done: the work stays on its branch on this Mac."],
  [/\bgit\s+remote\s+(?:add|set-url|rename|remove|rm)\b/, "Changing the repository's remotes is not allowed."],
  [/\bgit\s+(?:checkout|switch)\s+(?:main|master)\b|\bgit\s+(?:reset\s+--hard|rebase|filter-branch|update-ref)\b/, "Only the task's own branch is touched."],
  [/(?:^|[;&|(]\s*)(?:sudo|doas|su)\b/, "Nothing runs as an administrator."],
  [/\bsecurity\s+(?:find|dump|export)|\bdefaults\s+write\b|\blaunchctl\b|\bosascript\b/, "System settings, keychains and other apps are out of reach."],
  [/\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\brsync\b.*:|\bnc\b/, "Commands have no network."],
];
const ASKED: [RegExp, string][] = [
  [/\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/, "deletes folders"],
  [/\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+install\b|\bgem\s+install\b/, "installs software"],
  [/\bgit\s+(?:clean|branch\s+-[dD])\b/, "deletes files or branches"],
];

/** A sandboxed command's fate, in code: some are never run, some ask Keshab first, the rest run. */
export function classifyCommand(command: string): CommandVerdict {
  for (const [re, reason] of REFUSED) if (re.test(command)) return { verdict: "refuse", reason };
  for (const [re, reason] of ASKED) if (re.test(command)) return { verdict: "ask", reason };
  return { verdict: "allow" };
}
