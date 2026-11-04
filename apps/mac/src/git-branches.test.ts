import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchDiff, cleanRemote, pushBranch, repositoriesOf, arkBranches } from "./git-branches.ts";
import { prepareWorkdir } from "./worktree.ts";

// ADR-091: ARK's task branches like a pull request, and Keshab's push (never forced, only ark/task-*, only origin).

const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ark-git-")));
  const remote = join(root, "remote.git");
  execFileSync("git", ["init", "--bare", "-b", "main", remote]);
  const repo = join(root, "site");
  execFileSync("git", ["init", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-m", "start");
  sh(repo, "remote", "add", "origin", remote);
  sh(repo, "push", "origin", "main");
  sh(repo, "branch", "ark/task-7");
  sh(repo, "checkout", "ark/task-7");
  writeFileSync(join(repo, "notes.md"), "one\ntwo\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-m", "ARK task 7: Notes");
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
    const branch = (await arkBranches(repo, worktrees)).find((b) => b.task === 41)!;
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
    let [b] = await arkBranches(repo);
    assert.equal((await arkBranches(repo)).length, 1, "only task branches: ark/task-*, atom/task-* and zeno/task-*");
    assert.deepEqual([b!.branch, b!.task, b!.repoName, b!.pushed, b!.commits.map((c) => c.subject)], ["ark/task-7", 7, "site", "no", ["ARK task 7: Notes"]]);
    assert.deepEqual(b!.files, [{ path: "notes.md", added: 2, removed: 0 }]);
    assert.match((await branchDiff(repo, "ark/task-7")).text, /\+two/);
    await pushBranch(repo, "ark/task-7");
    [b] = await arkBranches(repo);
    assert.equal(b!.pushed, "yes");
    sh(repo, "checkout", "ark/task-7");
    writeFileSync(join(repo, "notes.md"), "one\ntwo\nthree\n");
    sh(repo, "commit", "-am", "more");
    sh(repo, "checkout", "main");
    [b] = await arkBranches(repo);
    assert.equal(b!.pushed, "changed");
    await assert.rejects(pushBranch(repo, "feature"), /Only ARK's task branches/);
    await assert.rejects(pushBranch(repo, "ark/task-99"), /There is no branch/);
    await assert.rejects(pushBranch(repo, "ark/task-99"), /There is no branch/);
    sh(repo, "remote", "remove", "origin");
    await assert.rejects(pushBranch(repo, "ark/task-7"), /no remote named origin/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a remote's address never shows credentials", () => {
  assert.equal(cleanRemote("https://keshab:ghp_secret@github.com/k/site.git"), "https://github.com/k/site.git");
  assert.equal(cleanRemote("git@github.com:k/site.git"), "git@github.com:k/site.git");
  assert.equal(cleanRemote("https://host/x?token=abc&y=1"), "https://host/x?token=…&y=1");
});

test("atom/task-N and zeno/task-N branches are listed beside ark/task-N ones, newest task first, and can be pushed (ADR-105, ADR-213)", async () => {
  const { root, repo } = setup();
  try {
    sh(repo, "branch", "atom/task-8");
    sh(repo, "branch", "zeno/task-9");
    assert.deepEqual((await arkBranches(repo)).map((b) => [b.branch, b.task]), [["zeno/task-9", 9], ["atom/task-8", 8], ["ark/task-7", 7]]);
    await pushBranch(repo, "atom/task-8");
    assert.equal((await arkBranches(repo))[1]!.pushed, "yes");
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
    assert.match((await branchDiff(repo, "ark/task-7")).text, /notes.md/);
    const branches = await arkBranches(repo); assert.equal(branches.length, 1);
    const { existsSync } = await import("node:fs"); assert.equal(existsSync(marker), false);
    assert.equal(cleanRemote("\u001b[31mhttps://user:token@host/x\n\u001b[0m"), "https://host/x");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ADR-240: a branch that changes what ARK may do, how it updates or what it depends on is never pushed from the window.
test("a task branch that changes a sensitive file is not pushed; one that changes only ordinary files still is", async () => {
  const { root, repo, remote } = setup();
  try {
    sh(repo, "branch", "ark/task-8");
    sh(repo, "checkout", "ark/task-8");
    writeFileSync(join(repo, "SECURITY.md"), "weaker\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-m", "ARK task 8: tweak");
    sh(repo, "checkout", "main");
    await assert.rejects(pushBranch(repo, "ark/task-8"), /SECURITY\.md.*does not push it from here/s);
    assert.equal(sh(repo, "ls-remote", remote, "refs/heads/ark/task-8"), "", "nothing reached the remote");
    await pushBranch(repo, "ark/task-7");
    assert.match(sh(repo, "ls-remote", remote, "refs/heads/ark/task-7"), /ark\/task-7/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
