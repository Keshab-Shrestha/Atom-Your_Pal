// ADR-082, Task 3.11: a worker never touches the current branch of a git repository. ZENO (not the model) makes a
// worktree on the task's own branch, `zeno/task-<id>`, outside the repository's folder, and commits the work there
// after the run. Nothing is ever pushed.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await run("git", ["-C", cwd, ...args], { timeout: 30_000 })).stdout.trim();

export interface Workdir {
  /** Where the worker works: the folder itself, or the same folder inside the task's worktree. */
  dir: string;
  /** In a git repository: the task's branch and the repository's top folder. */
  branch?: string;
  repo?: string;
}

/** The folder to work in for a task: in a repository, its worktree on `zeno/task-<id>` (made once, then reused). */
export async function prepareWorkdir(folder: string, taskId: number, worktrees: string): Promise<Workdir> {
  let repo: string;
  try {
    repo = await git(folder, "rev-parse", "--show-toplevel");
  } catch {
    return { dir: folder }; // not a repository: work in the folder itself
  }
  const branch = `zeno/task-${taskId}`;
  const tree = join(worktrees, `task-${taskId}`);
  if (!existsSync(tree)) {
    mkdirSync(worktrees, { recursive: true });
    const exists = await git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).then(() => true, () => false);
    await git(repo, "worktree", "add", ...(exists ? [tree, branch] : ["-b", branch, tree]));
  }
  // Real paths on both sides (git answers with them; /var is /private/var on macOS), and never a way out of the worktree.
  const inside = relative(realpathSync(repo), realpathSync(folder));
  if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("The folder is not inside its repository.");
  return { dir: join(tree, inside), branch, repo };
}

/** Commits everything changed in the worktree on its branch, as ZENO. False when nothing changed. */
export async function commitWork(dir: string, message: string): Promise<boolean> {
  await git(dir, "add", "-A");
  const changed = await git(dir, "diff", "--cached", "--quiet").then(() => false, () => true);
  if (!changed) return false;
  await git(dir, "-c", "user.name=ZENO", "-c", "user.email=zeno@localhost", "commit", "--no-verify", "-m", message);
  return true;
}
