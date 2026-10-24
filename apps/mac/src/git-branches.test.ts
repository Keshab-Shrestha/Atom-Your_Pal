import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchDiff, cleanRemote, pushBranch, repositoriesOf, zenoBranches } from "./git-branches.ts";
import { prepareWorkdir } from "./worktree.ts";

// ADR-091: ATOM's task branches like a pull request, and Keshab's push (never forced, only zeno/task-*, only origin).

const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-git-")));
  const remote = join(root, "remote.git");
  execFileSync("git", ["init", "--bare", "-b", "main", remote]);
  const repo = join(root, "site");
  execFileSync("git", ["init", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-m", "start");
  sh(repo, "remote", "add", "origin", remote);
  sh(repo, "push", "origin", "main");
  sh(repo, "branch", "zeno/task-7");
  sh(repo, "checkout", "zeno/task-7");
  writeFileSync(join(repo, "notes.md"), "one\ntwo\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-m", "ATOM task 7: Notes");
  sh(repo, "checkout", "main");
  sh(repo, "branch", "feature");
  return { root, repo, remote };
}

test("retained uncommitted task changes remain reviewable without changing branch history", async () => {
  const { root, repo } = setup();
  try {
    const worktrees = join(root, "task-work");
    const work = await prepareWorkdir(repo, 41, worktrees);
    const before = sh(repo, "rev-parse", "HEAD");
    writeFileSync(join(work.dir, "README.md"), "review this change\n");
    writeFileSync(join(work.dir, "new.md"), "new untracked work\n");
    const branch = (await zenoBranches(repo, worktrees)).find((b) => b.task === 41)!;
    assert.equal(branch.uncommitted, true);
    assert.equal(branch.worktree, work.tree);
    assert.equal(branch.commits.length, 0);
    assert.equal(sh(repo, "rev-parse", work.branch!), before);
    const diff = await branchDiff(repo, work.branch!, 200_000, worktrees);
    assert.match(diff.text, /\+review this change/);
    assert.match(diff.text, /untracked file contents are not included/);
    assert.equal(sh(repo, "status", "--porcelain"), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("task branches show their commits, files and whether they are pushed; Keshab's push sends one, never forced", async () => {
  const { root, repo } = setup();
  try {
    assert.deepEqual(await repositoriesOf([repo, join(repo, "."), root]), [repo], "each repository once; a plain folder is left out");
    let [b] = await zenoBranches(repo);
    assert.equal((await zenoBranches(repo)).length, 1, "only task branches: atom/task-* and zeno/task-*");
    assert.deepEqual([b!.branch, b!.task, b!.repoName, b!.pushed, b!.commits.map((c) => c.subject)], ["zeno/task-7", 7, "site", "no", ["ATOM task 7: Notes"]]);
    assert.deepEqual(b!.files, [{ path: "notes.md", added: 2, removed: 0 }]);
    assert.match((await branchDiff(repo, "zeno/task-7")).text, /\+two/);
    await pushBranch(repo, "zeno/task-7");
    [b] = await zenoBranches(repo);
    assert.equal(b!.pushed, "yes");
    sh(repo, "checkout", "zeno/task-7");
    writeFileSync(join(repo, "notes.md"), "one\ntwo\nthree\n");
    sh(repo, "commit", "-am", "more");
    sh(repo, "checkout", "main");
    [b] = await zenoBranches(repo);
    assert.equal(b!.pushed, "changed");
    await assert.rejects(pushBranch(repo, "feature"), /Only ATOM's task branches/);
    await assert.rejects(pushBranch(repo, "zeno/task-99"), /There is no branch/);
    await assert.rejects(pushBranch(repo, "atom/task-99"), /There is no branch/);
    sh(repo, "remote", "remove", "origin");
    await assert.rejects(pushBranch(repo, "zeno/task-7"), /no remote named origin/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a remote's address never shows credentials", () => {
  assert.equal(cleanRemote("https://keshab:ghp_secret@github.com/k/site.git"), "https://github.com/k/site.git");
  assert.equal(cleanRemote("git@github.com:k/site.git"), "git@github.com:k/site.git");
  assert.equal(cleanRemote("https://host/x?token=abc&y=1"), "https://host/x?token=…&y=1");
});

test("atom/task-N branches are listed beside zeno/task-N ones, newest task first, and can be pushed (ADR-105)", async () => {
  const { root, repo } = setup();
  try {
    sh(repo, "branch", "atom/task-8");
    assert.deepEqual((await zenoBranches(repo)).map((b) => [b.branch, b.task]), [["atom/task-8", 8], ["zeno/task-7", 7]]);
    await pushBranch(repo, "atom/task-8");
    assert.equal((await zenoBranches(repo))[0]!.pushed, "yes");
    assert.match((await branchDiff(repo, "atom/task-8")).text, /^$|\S/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("branch review never executes configured diff/textconv drivers and remote errors lose control codes", async () => {
  const { root, repo } = setup();
  try {
    const marker = join(root, "driver-ran");
    sh(repo, "config", "diff.external", `touch '${marker}'`);
    sh(repo, "config", "diff.fixture.textconv", `touch '${marker}'`);
    writeFileSync(join(repo, ".gitattributes"), "notes.md diff=fixture\n");
    assert.match((await branchDiff(repo, "zeno/task-7")).text, /notes.md/);
    const branches = await zenoBranches(repo); assert.equal(branches.length, 1);
    const { existsSync } = await import("node:fs"); assert.equal(existsSync(marker), false);
    assert.equal(cleanRemote("\u001b[31mhttps://user:token@host/x\n\u001b[0m"), "https://host/x");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
