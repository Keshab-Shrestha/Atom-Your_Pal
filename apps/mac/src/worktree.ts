// ADR-082, Task 3.11: a worker never touches the current branch of a git repository. ATOM (not the model) makes a
// worktree on the task's own branch, `atom/task-<id>`, outside the repository's folder, and commits the work there
// after the run. Workers never push (ADR-091: Keshab can push a branch from the Dashboard, see git-branches.ts).

import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { taskBranch } from "./branch-prefix.ts";

const run = promisify(execFile);
// No repository hooks and no file-system monitor ever run from here (they would run outside the sandbox). A worktree is only used
// after worktreeIntact() says its .git is still ATOM's link: the rest of a repository's config is Keshab's own.
export const git = async (cwd: string, ...args: string[]) =>
  (await run("git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { timeout: 30_000 })).stdout.trim();

/**
 * Is the task's worktree still the one ATOM made? Its top folder holds a `.git` FILE that points into the repository's own
 * `.git/worktrees/` folder. An agent in the sandbox can write the worktree, so it could delete that file and run `git init`: the new
 * `.git/config` could then name a command (core.fsmonitor, a filter driver) that runs when ATOM runs git there, outside the sandbox
 * (security review, 2026-10-16). False for anything else, and for anything that cannot be checked.
 */
export async function worktreeIntact(tree: string, repo: string): Promise<boolean> {
  try {
    const link = join(tree, ".git");
    if (!lstatSync(link).isFile()) return false; // a folder or a symlink: the agent made its own repository
    const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(link, "utf8"));
    if (!pointer) return false;
    const target = realpathSync.native(resolve(tree, pointer[1]!));
    // The repository's common git folder: `repo/.git`, or elsewhere when the repository is itself a worktree or a submodule.
    const common = await git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir").catch(() => join(repo, ".git"));
    const allowed = realpathSync.native(join(common, "worktrees"));
    return target.startsWith(allowed + sep);
  } catch {
    return false;
  }
}

export interface Workdir {
  /** Where the worker works: the folder itself, or the same folder inside the task's worktree. */
  dir: string;
  /** In a git repository: the task's branch, the repository's top folder and the worktree's own top folder. */
  branch?: string;
  repo?: string;
  tree?: string;
}

const hasBranch = (repo: string, branch: string) => git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).then(() => true, () => false);

/** `atom/task-<id>`, unless the task already has a branch under the old name, `zeno/task-<id>`: that one is kept. */
async function branchFor(repo: string, taskId: number): Promise<string> {
  const current = taskBranch(taskId);
  if (await hasBranch(repo, current)) return current;
  const legacy = taskBranch(taskId, true);
  return (await hasBranch(repo, legacy)) ? legacy : current;
}

/** The folder to work in for a task: in a repository, its worktree on `atom/task-<id>` (made once, then reused; a task that already has a `zeno/task-<id>` branch keeps it). */
export async function prepareWorkdir(folder: string, taskId: number, worktrees: string): Promise<Workdir> {
  let repo: string;
  try {
    repo = await git(folder, "rev-parse", "--show-toplevel");
  } catch {
    return { dir: folder }; // not a repository: work in the folder itself
  }
  // Real paths on both sides (git answers with them; /var is /private/var on macOS), and never a way out of the worktree.
  // `.native` gives the case the disk stores: macOS ignores case, and git reports the repository in the stored case.
  // Checked before anything is made, so a refusal leaves no worktree or branch behind.
  const inside = relative(realpathSync.native(repo), realpathSync.native(folder));
  if (inside === ".." || inside.startsWith("../") || isAbsolute(inside)) throw new Error("The folder is not inside its repository.");
  const branch = await branchFor(repo, taskId);
  const tree = join(worktrees, `task-${taskId}`);
  if (!existsSync(tree)) {
    mkdirSync(worktrees, { recursive: true });
    const exists = await hasBranch(repo, branch);
    await git(repo, "worktree", "add", ...(exists ? [tree, branch] : ["-b", branch, tree]));
  }
  return { dir: join(tree, inside), branch, repo, tree };
}

/** Commits everything changed in the worktree on its branch, as ATOM. False when nothing changed. */
export async function commitWork(dir: string, message: string, guard?: { tree: string; repo: string }): Promise<boolean> {
  if (guard && !(await worktreeIntact(guard.tree, guard.repo))) throw new Error("The task's worktree was changed since ATOM made it, so nothing was committed.");
  // With a guard, git runs from the verified top of the worktree, never from the project's subfolder inside it: an agent can `git init`
  // there, and git would use that repository, with filter drivers and other config the guard never looked at (review, 2026-10-16).
  // A repository below the top is then only a folder git records as a nested repository; its config is not read.
  const top = guard?.tree ?? dir;
  await git(top, "add", "-A");
  const changed = await git(top, "diff", "--cached", "--quiet").then(() => false, () => true);
  if (!changed) return false;
  await git(top, "-c", "user.name=ATOM", "-c", "user.email=atom@localhost", "commit", "--no-verify", "-m", message);
  return true;
}
