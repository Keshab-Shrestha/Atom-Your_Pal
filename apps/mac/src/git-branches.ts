// ADR-091: the branches ATOM made for workers' tasks (`zeno/task-<id>`, Task 3.11), shown like a pull request: their
// commits, changed files and whether they are on the remote. Keshab pushes one by clicking and confirming in the ATOM
// window: only such a branch, only to the repository's own `origin`, never forced, no hooks, no password prompts.
// Workers and models never push.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { git } from "./worktree.ts";

const run = promisify(execFile);

export const BRANCH_PATTERN = /^zeno\/task-(\d+)$/;
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
  /** What it is compared with: the remote's default branch, else the repository's current one. */
  base: string;
  commits: BranchCommit[];
  files: BranchFile[];
  /** `origin`'s address without any user name, password or token. Absent when there is no `origin`. */
  remote?: string;
  /** "no": not on the remote; "yes": the remote has exactly it; "changed": it moved on since the last push. */
  pushed: "no" | "yes" | "changed";
}

/** A remote's address with any credentials taken out (`https://user:token@host/x` → `https://host/x`). */
export function cleanRemote(url: string): string {
  return url.replace(/^([a-z][\w+.-]*:\/\/)[^@/]*@/i, "$1").replace(/([?&](?:token|key|secret|password)=)[^&]*/gi, "$1…");
}

/** The repositories the given folders are in (each once). Folders that are not in one are left out. */
export async function repositoriesOf(folders: readonly string[]): Promise<string[]> {
  const tops = await Promise.all(folders.map((f) => git(f, "rev-parse", "--show-toplevel").catch(() => undefined)));
  return [...new Set(tops.filter((t): t is string => Boolean(t)))];
}

async function baseOf(repo: string): Promise<string> {
  const remoteHead = await git(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD").catch(() => "");
  if (remoteHead) return remoteHead;
  return git(repo, "rev-parse", "--abbrev-ref", "HEAD");
}

/** Every `zeno/task-<id>` branch in a repository, newest task first. */
export async function zenoBranches(repo: string): Promise<ZenoBranch[]> {
  const names = (await git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/zeno/")).split("\n").filter((b) => BRANCH_PATTERN.test(b));
  if (!names.length) return [];
  const base = await baseOf(repo);
  const remote = await git(repo, "remote", "get-url", "origin").catch(() => undefined);
  const repoName = repo.split("/").at(-1) ?? repo;
  const branches = await Promise.all(
    names.map(async (branch): Promise<ZenoBranch> => {
      const log = await git(repo, "log", `--max-count=${MAX_COMMITS}`, "--format=%h%x09%cI%x09%s", `${base}..${branch}`).catch(() => "");
      const commits = log ? log.split("\n").map((line) => {
        const [sha = "", at = "", ...subject] = line.split("\t");
        return { sha, at, subject: subject.join("\t") };
      }) : [];
      const stat = await git(repo, "diff", "--numstat", `${base}...${branch}`).catch(() => "");
      const files = stat ? stat.split("\n").slice(0, MAX_FILES).map((line) => {
        const [added = "-", removed = "-", ...path] = line.split("\t");
        return { path: path.join("\t"), added: added === "-" ? null : Number(added), removed: removed === "-" ? null : Number(removed) };
      }) : [];
      const head = await git(repo, "rev-parse", branch);
      const onRemote = await git(repo, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`).catch(() => "");
      return {
        repo,
        repoName,
        branch,
        task: Number(BRANCH_PATTERN.exec(branch)![1]),
        base,
        commits,
        files,
        ...(remote ? { remote: cleanRemote(remote) } : {}),
        pushed: !onRemote ? "no" : onRemote === head ? "yes" : "changed",
      };
    }),
  );
  return branches.sort((a, b) => b.task - a.task);
}

/** The branch's changes since its base, as a patch, cut at `limit` characters. */
export async function branchDiff(repo: string, branch: string, limit = 200_000): Promise<{ text: string; truncated: boolean }> {
  if (!BRANCH_PATTERN.test(branch)) throw new Error("Only ATOM's task branches can be shown.");
  const base = await baseOf(repo);
  const { stdout } = await run("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", "diff", "--no-color", `${base}...${branch}`], { timeout: 30_000, maxBuffer: 20 * 1024 * 1024 });
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
    await run("git", ["-C", repo, "-c", "core.hooksPath=/dev/null", "push", "--no-verify", "origin", `refs/heads/${branch}:refs/heads/${branch}`], {
      timeout: PUSH_TIMEOUT_MS,
      // Never wait for a password: a remote that needs one fails with words instead.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" },
    });
  } catch (error) {
    const said = String((error as { stderr?: unknown }).stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const why = said.find((l) => /rejected|denied|could not|fatal|error/i.test(l)) ?? said.at(-1) ?? "git could not push it";
    throw new Error(`The push failed: ${cleanRemote(why).slice(0, 200)}`);
  }
}
