import { lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { HelperError } from "./jobs.ts";

// ADR-082, Task 3.11: folder grants and the checks every file tool and command passes, in code. A soul, a task or a
// page can never widen them.

export const MAX_GRANTS = 8;

/** Folders inside the home folder that hold keys, tokens and other apps' secrets (never readable by commands, never checkpointed). */
export const DENY_READ_DIRS = [
  ".ssh", ".aws", ".gnupg", ".config", ".netrc", ".npmrc", ".docker", ".kube", ".azure", ".claude", ".codex", ".hermes", "Library/Keychains", "Library/Cookies",
  // 2026-10-16 (code check): shell history and credentials, and the stores of mail, messages and browsers (a command in a project chat could cat them).
  ".zsh_history", ".bash_history", ".zsh_sessions", ".git-credentials", ".python_history", ".node_repl_history", ".viminfo", ".lesshst", ".pypirc",
  "Library/Mail", "Library/Messages", "Library/Safari", "Library/Calendars", "Library/Group Containers", "Library/Containers",
  "Library/Application Support/Google", "Library/Application Support/Firefox", "Library/Application Support/BraveSoftware", "Library/Application Support/Arc",
  "Library/Application Support/Microsoft Edge", "Library/Application Support/AddressBook",
];

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

/**
 * ADR-122: the fixed floor. Why a file tool's path is refused for EVERY agent, whatever folder it was given, or undefined when it may be used.
 * There are no per-agent folders any more: a path is allowed when it is inside the home folder (or an external drive) and not in a protected
 * place. Protected: outside home; ~/Library (any case); any hidden folder or file under home; git's own files (writing); names of important
 * personal documents (best effort). `roots` are the task's own folders (a project, a worktree): inside them the hidden-folder and the
 * name checks do not apply, because the project is where the work is, but the secret and git checks (made by the caller) still do.
 */
export function floorProblem(home: string, roots: readonly string[], cwd: string, rawPath: string, writing = false): string | undefined {
  // A shell would turn "~/.zshrc" into the home folder's file; here resolve() made it "<cwd>/~/.zshrc", inside the task's folder (code check,
  // 2026-10-16). "~" is expanded the way a shell does, and a variable or command substitution in a path is refused: it cannot be checked.
  if (/[$`]/.test(rawPath)) return "A path with $ or a backtick in it cannot be checked, so it is not used. Write the whole path.";
  const p = expandHome(rawPath, home);
  const real = realish(isAbsolute(p) ? p : resolve(cwd, p));
  const homeReal = realish(home);
  const inRoot = roots.some((root) => isInside(root, real));
  const volumes = isInside("/Volumes", real);
  if (!inRoot && !volumes && !isInside(homeReal, real)) return `${p} is outside your home folder.`;
  if (writing && hasGitPart(real)) return "Git's own files are not changed by hand: ATOM commits the work.";
  if (inRoot) return undefined;
  const base = volumes ? "/Volumes" : homeReal;
  const parts = relative(base, real).split(sep).filter(Boolean);
  if (!volumes && parts[0]?.toLowerCase() === "library") return "~/Library holds apps' data and is never opened by an agent.";
  if (parts.some((part) => part.startsWith("."))) return "Hidden folders and files hold keys and settings and are never opened by an agent.";
  if (parts.some(isImportantName)) return "This looks like an important personal document (identity, bank, tax, medical or similar) and is never opened by an agent.";
  return undefined;
}

/** "~" and "~/x" as a shell reads them (another user's "~name" is left alone, and is then refused as a path outside home). */
export function expandHome(p: string, home: string): string {
  return p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p;
}

/** ADR-123: names of important personal documents. A net, not a guarantee: it can miss a file and can refuse an innocent one. */
const IMPORTANT_NAME = /(^|[^a-z])(passport|visa|citizenship|national[ _-]?id|id[ _-]?card|birth[ _-]?certificate|bank|tax|insurance|medical|ssn|payslip|salary)([^a-z]|$)/i;
export const isImportantName = (name: string): boolean => IMPORTANT_NAME.test(name);

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
// ADR-123: delete and anything that harms the OS is never run. Deleting is refused outright (Keshab, 2026-10-16); an agent has no delete tool, and
// this closes the shell.
const DELETE_AND_HARM: [RegExp, string][] = [
  // 2026-10-16 (security review): a regex list cannot be complete, so the common ways round it are closed too: the command anywhere as a word (not only
  // after a separator), a backslash or full path before it, inline code in a shell or an interpreter, and the delete calls of the usual languages.
  // The real limits are the sandbox (writes only in the project folder, no network) and the copies kept for undo.
  [/(?<![\w.\-])\\?(?:\/(?:usr\/)?(?:local\/)?bin\/)?(?:rm|rmdir|unlink|trash|shred|srm)(?=\s|$|;|&|\|)/, "Deleting is never done by an agent: Keshab deletes in Finder."],
  [/(?<![\w.\-])(?:sh|bash|zsh|dash|ksh|fish)\s+(?:-[a-zA-Z]*c\b|--command)|(?<![\w.\-])eval\s|(?<![\w.\-])(?:node|nodejs|deno|bun)\s+(?:-e\b|--eval\b|-p\b|--print\b)|(?<![\w.\-])python[0-9.]*\s+-[a-zA-Z]*c\b|(?<![\w.\-])(?:perl|ruby|php)\s+-[a-zA-Z]*[er]\b/, "Run a script file, not inline code: inline code cannot be checked."],
  [/\b(?:rmSync|unlinkSync|rmdirSync|fs\.rm|fs\.unlink|fs\.rmdir|rmtree|os\.remove|os\.unlink|os\.rmdir|shutil\.rmtree|FileUtils\.rm|File\.delete|Files\.delete|unlink\s*\()/, "Deleting is never done by an agent: Keshab deletes in Finder."],
  [/\bmv\b[^\n;|&]*\/dev\/null|(?<![\w.\-])truncate\s/, "Emptying files is never done by an agent."],
  [new RegExp(`${GIT}(?:stash\\s+(?:clear|drop)|worktree\\s+(?:remove|prune)|gc\\s+--prune|reflog\\s+expire|prune\\b|replace\\b)`), "That git command throws work away and is never run by an agent."],
  [/(?:^|[;&|(\n]\s*|\b(?:env|xargs|command|exec|nohup|time|sudo)\s+)(?:rm|rmdir|unlink|trash|shred|srm)\b|\bfind\b[^\n;|&]*(?:-delete\b|-exec\s+(?:rm|rmdir|unlink)\b)/, "Deleting is never done by an agent: Keshab deletes in Finder."],
  [new RegExp(`${GIT}(?:clean|rm)\\b|${GIT}branch\\s+(?:-[dD]|--delete)\\b`), "Deleting files or branches is never done by an agent."],
  [/(?:^|[;&|(\n]\s*|\b(?:env|xargs|command|exec|nohup|time)\s+)(?:dd|mkfs\S*|diskutil|hdiutil|fdisk|newfs\S*|chown|chgrp|kill|killall|pkill|shutdown|reboot|halt|pmset|networksetup|scutil|csrutil|spctl|tccutil|nvram|systemsetup|dscl|fdesetup)\b/, "That command changes the system and is never run by an agent."],
  [/\bchmod\s+(?:-[a-zA-Z]*R[a-zA-Z]*|--recursive)\b/, "Changing permissions of whole folders is never done by an agent."],
  [/>>?\s*\/(?:System|Library|usr|etc|bin|sbin|private|Applications|var)\b|\btee\s+(?:-a\s+)?\/(?:System|Library|usr|etc|bin|sbin|private|Applications|var)\b/, "System folders are never written by an agent."],
  [/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/, "A fork bomb."],
];
const ASKED: [RegExp, string][] = [
  [/\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+install\b|\bgem\s+install\b/, "installs software"],
]; 

/** A sandboxed command's fate, in code: some are never run, some ask Keshab first, the rest run. */
export function classifyCommand(command: string): CommandVerdict {
  for (const [re, reason] of REFUSED) if (re.test(command)) return { verdict: "refuse", reason };
  for (const [re, reason] of DELETE_AND_HARM) if (re.test(command)) return { verdict: "refuse", reason };
  for (const [re, reason] of ASKED) if (re.test(command)) return { verdict: "ask", reason };
  return { verdict: "allow" };
}
