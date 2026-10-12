import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitWork, prepareWorkdir } from "./worktree.ts";

// Task 3.11: the task's own branch in a worktree; the current branch is never touched; nothing is pushed.

const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

test("a repository gets a worktree on zeno/task-N; the work is committed there and the current branch is untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "atom-wt-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(join(repo, "app"), { recursive: true });
    sh(root, "init", "-q", "-b", "main", repo);
    writeFileSync(join(repo, "app", "a.txt"), "one\n");
    sh(repo, "add", "-A");
    sh(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "first");
    const work = await prepareWorkdir(join(repo, "app"), 12, join(root, "worktrees"));
    assert.deepEqual([work.branch, work.dir], ["zeno/task-12", join(root, "worktrees", "task-12", "app")]);
    assert.equal(work.repo, realpathSync(repo));
    writeFileSync(join(work.dir, "a.txt"), "two\n");
    assert.equal(await commitWork(work.dir, "ATOM task 12: change a"), true);
    assert.equal(await commitWork(work.dir, "again"), false, "nothing changed");
    assert.equal(sh(repo, "rev-parse", "--abbrev-ref", "HEAD"), "main");
    assert.equal(readFileSync(join(repo, "app", "a.txt"), "utf8"), "one\n", "the current branch's files are untouched");
    assert.equal(sh(repo, "log", "-1", "--format=%an %s", "zeno/task-12"), "ATOM ATOM task 12: change a");
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
