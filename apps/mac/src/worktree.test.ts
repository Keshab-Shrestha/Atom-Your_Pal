import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitWork, prepareWorkdir, worktreeIntact } from "./worktree.ts";

// Task 3.11: the task's own branch in a worktree; the current branch is never touched; nothing is pushed.

const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

test("a repository gets a worktree on atom/task-N; the work is committed there and the current branch is untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "atom-wt-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(join(repo, "app"), { recursive: true });
    sh(root, "init", "-q", "-b", "main", repo);
    writeFileSync(join(repo, "app", "a.txt"), "one\n");
    sh(repo, "add", "-A");
    sh(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
    const work = await prepareWorkdir(join(repo, "app"), 12, join(root, "worktrees"));
    assert.deepEqual([work.branch, work.dir], ["atom/task-12", join(root, "worktrees", "task-12", "app")]);
    assert.equal(work.repo, realpathSync(repo));
    writeFileSync(join(work.dir, "a.txt"), "two\n");
    assert.equal(await commitWork(work.dir, "ATOM task 12: change a"), true);
    assert.equal(await commitWork(work.dir, "again"), false, "nothing changed");
    assert.equal(sh(repo, "rev-parse", "--abbrev-ref", "HEAD"), "main");
    assert.equal(readFileSync(join(repo, "app", "a.txt"), "utf8"), "one\n", "the current branch's files are untouched");
    assert.equal(sh(repo, "log", "-1", "--format=%an %s", "atom/task-12"), "ATOM ATOM task 12: change a");
    assert.equal(sh(repo, "remote"), "", "no remote was added, nothing pushed");
    const again = await prepareWorkdir(join(repo, "app"), 12, join(root, "worktrees"));
    assert.equal(again.dir, work.dir, "a second run reuses the worktree");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a plain folder is worked in directly", async () => {
  const root = mkdtempSync(join(tmpdir(), "atom-wt-"));
  try {
    assert.deepEqual(await prepareWorkdir(root, 3, join(root, "wt")), { dir: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a task that already has a zeno/task-N branch keeps it; a new task gets atom/task-N (ADR-105)", async () => {
  const root = mkdtempSync(join(tmpdir(), "atom-wt-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    sh(root, "init", "-q", "-b", "main", repo);
    writeFileSync(join(repo, "a.txt"), "one\n");
    sh(repo, "add", "-A");
    sh(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
    sh(repo, "branch", "zeno/task-13");
    const old = await prepareWorkdir(repo, 13, join(root, "worktrees"));
    assert.equal(old.branch, "zeno/task-13");
    assert.equal(sh(repo, "branch", "--list", "atom/task-13"), "", "the old branch is not replaced by a new one");
    const fresh = await prepareWorkdir(repo, 14, join(root, "worktrees"));
    assert.equal(fresh.branch, "atom/task-14");
    assert.equal((await prepareWorkdir(repo, 14, join(root, "worktrees"))).branch, "atom/task-14", "a second run keeps it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// macOS ignores letter case in paths: a folder granted as ~/Documents/ZENO whose repository git reports as ~/Documents/zeno is inside it.
test("a folder written in a different letter case than its repository is still inside it", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "atom-wt-"));
  try {
    const repo = join(root, "Repo");
    mkdirSync(join(repo, "app"), { recursive: true });
    if (existsSync(join(root, "REPO"))) {
      // a case-insensitive disk (the macOS default): the case of the typed path differs from the real one
    } else return void t.skip("this disk is case-sensitive");
    sh(root, "init", "-q", "-b", "main", repo);
    writeFileSync(join(repo, "app", "a.txt"), "one\n");
    sh(repo, "add", "-A");
    sh(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
    const work = await prepareWorkdir(join(root, "REPO", "app"), 13, join(root, "worktrees"));
    assert.equal(work.branch, "atom/task-13");
    assert.equal(work.dir, join(root, "worktrees", "task-13", "app"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 2026-10-16 (security review): an agent in its worktree could `rm .git; git init`, set core.fsmonitor in the new .git/config, and ATOM's
// `git add -A` ran that command outside the sandbox. ATOM now commits only when the worktree's .git is still its link into the repository.
test("a worktree whose .git link was replaced by the agent's own repository is never committed, and its commands never run", async () => {
  const root = mkdtempSync(join(tmpdir(), "atom-wt-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    sh(root, "init", "-q", "-b", "main", repo);
    writeFileSync(join(repo, "a.txt"), "one\n");
    sh(repo, "add", "-A");
    sh(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
    const work = await prepareWorkdir(repo, 31, join(root, "worktrees"));
    const guard = { tree: work.tree!, repo: work.repo! };
    assert.equal(await worktreeIntact(guard.tree, guard.repo), true, "a fresh worktree is intact");
    writeFileSync(join(work.dir, "a.txt"), "two\n");
    assert.equal(await commitWork(work.dir, "ok", guard), true, "an intact worktree commits");

    // The attack: replace .git with a repository of the agent's own, whose config runs a command at `git add`.
    const marker = join(root, "ran-marker");
    rmSync(join(work.tree!, ".git"), { force: true });
    sh(work.tree!, "init", "-q");
    writeFileSync(join(work.tree!, "hook.sh"), `#!/bin/sh\necho ran > ${marker}\n`, { mode: 0o755 });
    sh(work.tree!, "config", "core.fsmonitor", join(work.tree!, "hook.sh"));
    writeFileSync(join(work.dir, "a.txt"), "three\n");
    assert.equal(await worktreeIntact(guard.tree, guard.repo), false, "the swapped .git is detected");
    await assert.rejects(() => commitWork(work.dir, "attack", guard), /worktree/i);
    assert.equal(existsSync(marker), false, "the agent's command never ran");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a worktree whose .git file points somewhere else, or is a symlink, is not intact", async () => {
  const root = mkdtempSync(join(tmpdir(), "atom-wt-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    sh(root, "init", "-q", "-b", "main", repo);
    writeFileSync(join(repo, "a.txt"), "one\n");
    sh(repo, "add", "-A");
    sh(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
    const work = await prepareWorkdir(repo, 32, join(root, "worktrees"));
    const link = join(work.tree!, ".git");
    writeFileSync(link, `gitdir: ${join(root, "elsewhere")}\n`);
    assert.equal(await worktreeIntact(work.tree!, work.repo!), false, "points outside the repository's worktrees folder");
    writeFileSync(link, "not a gitdir line\n");
    assert.equal(await worktreeIntact(work.tree!, work.repo!), false, "not a link at all");
    assert.equal(await worktreeIntact(join(root, "no-such-tree"), work.repo!), false, "a missing worktree");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
