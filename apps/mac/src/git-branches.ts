// ADR-091: the branches ATOM made for workers' tasks (`atom/task-<id>` or, from before ADR-105, `zeno/task-<id>`; Task 3.11), shown like a pull request: their
// commits, changed files and whether they are on the remote. Keshab pushes one by clicking and confirming in the ATOM
// window: only such a branch, only to the repository's own `origin`, never forced, no hooks, no password prompts.
// Workers and models never push.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BRANCH_PATTERN, BRANCH_REF_FOLDERS } from "./branch-prefix.ts";
import { readTaskBranchBase } from "./task-branch-base.ts";
import { join } from "node:path";
import { lstatSync } from "node:fs";
import { worktreeIntact } from "./worktree.ts";
import { workingCopyDirty, workingCopyDiff } from "./git-review.ts";

const run = promisify(execFile);
const environment = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GIT_PAGER: "cat" });
const git = async (repo: string, ...args: string[]) => (await run("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { timeout: 30_000, maxBuffer: 20 * 1024 * 1024, env: environment() })).stdout.trim();

export const PUSH_TIMEOUT_MS = 120_000;
const MAX_COMMITS = 50;
const MAX_FILES = 200;

export interface BranchCommit {
  sha: string;
  subject: string;
  at: string;
}

export interface BranchFile {
  path: string;
  /** Lines added and removed; null for a binary file. */
  added: number | null;
  removed: number | null;
}

export interface ZenoBranch {
  repo: string;
  repoName: string;
  branch: string;
  task: number;
  /** Creation branch label for a saved base; otherwise an explicitly estimated comparison. */
  base: string;
  baseSHA?: string;
  baseSource?: "saved" | "estimated" | "unavailable";
  baseWarning?: string;
  /** Commits on the current creation branch not reachable from the task. Local refs only; never fetches. */
  behind?: number;
  commits: BranchCommit[];
  files: BranchFile[];
  /** `origin`'s address without any user name, password or token. Absent when there is no `origin`. */
  remote?: string;
  /** "no": not on the remote; "yes": the remote has exactly it; "changed": it moved on since the last push. */
  pushed: "no" | "yes" | "changed";
  worktree?: string;
  uncommitted?: boolean;
}

/** Only the host-created, still-owned worktree for this exact task branch. Never select a caller-supplied path. */
export async function taskWorkingCopy(repo: string, branch: string, worktrees?: string): Promise<string | undefined> {
  const id = BRANCH_PATTERN.exec(branch)?.[1];
  if (!id || !worktrees) return;
  const tree = join(worktrees, `task-${id}`);
  try {
    if (!readTaskBranchBase(worktrees, repo, branch)) return;
    const stat = lstatSync(tree);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    if (!await worktreeIntact(tree, repo)) return;
    if (await git(tree, "symbolic-ref", "--quiet", "--short", "HEAD") !== branch) return;
    return tree;
  } catch { return; }
}

/** A remote's address with any credentials taken out (`https://user:token@host/x` → `https://host/x`). */
export function cleanRemote(url: string): string {
  return url.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "").replace(/^([a-z][\w+.-]*:\/\/)[^@/]*@/i, "$1").replace(/([?&](?:token|key|secret|password)=)[^&]*/gi, "$1…");
}

/** The repositories the given folders are in (each once). Folders that are not in one are left out. */
export async function repositoriesOf(folders: readonly string[]): Promise<string[]> {
  const tops = await Promise.all(folders.map((f) => git(f, "rev-parse", "--show-toplevel").catch(() => undefined)));
  return [...new Set(tops.filter((t): t is string => Boolean(t)))];
}

async function comparison(repo: string, branch: string, worktrees?: string) {
  const saved = readTaskBranchBase(worktrees, repo, branch);
  let ref = saved?.ref;
  if (!saved) {
    ref = await git(repo, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD").catch(() => "");
    if (!ref) ref = await git(repo, "symbolic-ref", "--quiet", "HEAD").catch(() => "");
    if (!ref || /^refs\/heads\/(?:atom|zeno)\/task-\d+$/.test(ref)) throw new Error("No saved starting point. Check out the intended base branch to estimate a comparison.");
  }
  const candidate = await git(repo, "rev-parse", "--verify", `${saved?.sha ?? ref}^{commit}`);
  const head = await git(repo, "rev-parse", "--verify", `refs/heads/${branch}^{commit}`);
  const sha = saved ? candidate : await git(repo, "merge-base", candidate, head);
  // Resolve moving names once. Subsequent log/diff reads use object IDs, even if HEAD or the base moves.
  const tip = ref ? await git(repo, "rev-parse", "--verify", `${ref}^{commit}`).catch(() => "") : "";
  const behind = tip ? Number(await git(repo, "rev-list", "--count", `${head}..${tip}`)) : undefined;
  return { sha, head, base: ref?.replace(/^refs\/(heads|remotes)\//, "") ?? "detached HEAD", baseSource: saved ? "saved" as const : "estimated" as const, ...(behind !== undefined ? { behind } : {}) };
}

/** Every `atom/task-<id>` and `zeno/task-<id>` branch in a repository, newest task first. */
export async function zenoBranches(repo: string, worktrees?: string): Promise<ZenoBranch[]> {
  const names = (await git(repo, "for-each-ref", "--format=%(refname:short)", ...BRANCH_REF_FOLDERS)).split("\n").filter((b) => BRANCH_PATTERN.test(b));
  if (!names.length) return [];
  const remote = await git(repo, "remote", "get-url", "origin").catch(() => undefined);
  const repoName = repo.split("/").at(-1) ?? repo;
  const branches = await Promise.all(
    names.map(async (branch): Promise<ZenoBranch> => {
      let point: Awaited<ReturnType<typeof comparison>> | undefined;
      let baseWarning: string | undefined;
      try { point = await comparison(repo, branch, worktrees); }
      catch { baseWarning = "Starting point unavailable. No comparison is shown; check the saved base or check out the intended base branch for an older task."; }
      const worktree = await taskWorkingCopy(repo, branch, worktrees);
      const uncommitted = worktree ? await workingCopyDirty(worktree) : false;
      let log = "", stat = "";
      if (point) {
        try {
          log = await git(repo, "log", `--max-count=${MAX_COMMITS}`, "--format=%h%x09%cI%x09%s", `${point.sha}..${point.head}`);
          stat = worktree ? await workingCopyDiff(worktree, point.sha, true) : await git(repo, "diff", "--no-ext-diff", "--no-textconv", "--numstat", `${point.sha}..${point.head}`);
        } catch { baseWarning = "Git could not read this comparison. Refresh to try again."; log = ""; stat = ""; }
      }
      const commits = log ? log.split("\n").map((line) => {
        const [sha = "", at = "", ...subject] = line.split("\t");
        return { sha, at, subject: subject.join("\t") };
      }) : [];
      const files = stat ? stat.split("\n").slice(0, MAX_FILES).map((line) => {
        const [added = "-", removed = "-", ...path] = line.split("\t");
        return { path: path.join("\t"), added: added === "-" ? null : Number(added), removed: removed === "-" ? null : Number(removed) };
      }) : [];
      const head = await git(repo, "rev-parse", branch).catch(() => ""); // a branch deleted since it was listed must not empty the whole repo's list
      const onRemote = await git(repo, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`).catch(() => "");
      return {
        repo,
        repoName,
        branch,
        task: Number(BRANCH_PATTERN.exec(branch)![1]),
        base: point?.base ?? "unavailable",
        baseSource: baseWarning ? "unavailable" : point?.baseSource ?? "unavailable",
        ...(point ? { baseSHA: point.sha, ...(point.behind !== undefined ? { behind: point.behind } : {}) } : {}),
        ...(baseWarning ? { baseWarning } : {}),
        commits,
        files,
        ...(worktree ? { worktree, uncommitted } : {}),
        ...(remote ? { remote: cleanRemote(remote) } : {}),
        pushed: !onRemote ? "no" : onRemote === head ? "yes" : "changed",
      };
    }),
  );
  return branches.sort((a, b) => b.task - a.task);
}

/** The branch's changes since its base, as a patch, cut at `limit` characters. */
export async function branchDiff(repo: string, branch: string, limit = 200_000, worktrees?: string): Promise<{ text: string; truncated: boolean }> {
  if (!BRANCH_PATTERN.test(branch)) throw new Error("Only ATOM's task branches can be shown.");
  const point = await comparison(repo, branch, worktrees);
  const tree = await taskWorkingCopy(repo, branch, worktrees);
  const patch = tree ? await workingCopyDiff(tree, point.sha) : (await run("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv", `${point.sha}..${point.head}`], { timeout: 30_000, maxBuffer: 20 * 1024 * 1024, env: environment() })).stdout;
  if (tree && await taskWorkingCopy(repo, branch, worktrees) !== tree) throw new Error("The task working copy changed during review. Refresh before continuing.");
  const dirty = tree && await workingCopyDirty(tree);
  const stdout = patch + (dirty ? "\nWorking-copy comparison. New untracked file contents are not included until explicitly staged.\n" : "");
  return stdout.length > limit ? { text: stdout.slice(0, limit), truncated: true } : { text: stdout, truncated: false };
}

/**
 * Pushes one of ATOM's task branches to the repository's `origin`, as Keshab asked. Throws, with words for him, for
 * any other branch, a repository with no `origin`, or a push git refuses (it is never forced).
 */
export async function pushBranch(repo: string, branch: string): Promise<void> {
  if (!BRANCH_PATTERN.test(branch)) throw new Error("Only ATOM's task branches can be pushed from here.");
  await git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).catch(() => {
    throw new Error(`There is no branch ${branch} in ${repo}.`);
  });
  await git(repo, "remote", "get-url", "origin").catch(() => {
    throw new Error("This repository has no remote named origin to push to.");
  });
  try {
    await run("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "push", "--no-verify", "origin", `refs/heads/${branch}:refs/heads/${branch}`], {
      timeout: PUSH_TIMEOUT_MS,
      // Never wait for a password: a remote that needs one fails with words instead.
      env: environment(),
    });
  } catch (error) {
    const said = String((error as { stderr?: unknown }).stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const why = said.find((l) => /rejected|denied|could not|fatal|error/i.test(l)) ?? said.at(-1) ?? "git could not push it";
    throw new Error(`The push failed: ${cleanRemote(why).slice(0, 200)}`);
  }
}
