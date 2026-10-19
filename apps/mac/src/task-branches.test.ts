import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@atom/helpers";
import { branchDiff, zenoBranches } from "./git-branches.ts";
import { createIslandGit } from "./island-wiring.ts";
import { commitWork, prepareWorkdir } from "./worktree.ts";
import { readTaskBranchBase, saveTaskBranchBase } from "./task-branch-base.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=T", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-task-base-")));
  const repo = join(root, "repo"), worktrees = join(root, "worktrees");
  mkdirSync(join(repo, "app"), { recursive: true });
  git(root, "init", "-q", "-b", "main", repo);
  writeFileSync(join(repo, "launch.txt"), "Wednesday\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "start");
  return { root, repo, worktrees, sha: git(repo, "rev-parse", "HEAD") };
}

test("new task branches preserve their exact starting commit across reuse, base movement, checkout and host reconstruction", async () => {
  const { root, repo, worktrees, sha } = setup();
  try {
    const work = await prepareWorkdir(repo, 41, worktrees);
    assert.deepEqual(readTaskBranchBase(worktrees, repo, work.branch!), { repo, branch: "atom/task-41", sha, ref: "refs/heads/main" });
    writeFileSync(join(work.dir, "launch.txt"), "Thursday\n");
    await commitWork(work.dir, "task change", { repo, tree: work.tree! });
    writeFileSync(join(repo, "other.txt"), "new base work\n");
    git(repo, "add", "-A"); git(repo, "commit", "-qm", "base advances");
    git(repo, "checkout", "-qb", "unrelated");
    await prepareWorkdir(repo, 41, worktrees);
    const [branch] = await zenoBranches(repo, worktrees);
    assert.equal(branch!.baseSHA, sha); assert.equal(branch!.baseSource, "saved");
    assert.equal(branch!.base, "main"); assert.equal(branch!.behind, 1);
    assert.deepEqual(branch!.commits.map((c) => c.subject), ["task change"]);
    assert.deepEqual(branch!.files.map((f) => f.path), ["launch.txt"]);
    const diff = await branchDiff(repo, branch!.branch, 200_000, worktrees);
    assert.match(diff.text, /-Wednesday\n\+Thursday/); assert.doesNotMatch(diff.text, /other.txt/);
    git(repo, "branch", "-D", "main");
    const [withoutRef] = await zenoBranches(repo, worktrees);
    assert.equal(withoutRef!.baseSHA, sha); assert.equal(withoutRef!.behind, undefined, "missing current base is unknown, not zero");
    assert.equal((await branchDiff(repo, branch!.branch, 200_000, worktrees)).text, diff.text);
    assert.throws(() => saveTaskBranchBase(worktrees, { repo, branch: branch!.branch, sha }), /EEXIST/);
    assert.equal(git(repo, "remote"), "", "no remote operations or configuration");
    const inherited = process.env.GIT_DIR;
    try {
      process.env.GIT_DIR = join(root, "not-a-repository");
      assert.equal((await zenoBranches(repo, worktrees))[0]!.baseSHA, sha, "inherited Git routing cannot redirect branch reads");
      assert.match((await branchDiff(repo, branch!.branch, 200_000, worktrees)).text, /Thursday/);
    } finally { if (inherited === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = inherited; }

  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("legacy and existing branches are never backfilled; a task checked out without a base cannot compare to itself", async () => {
  const { root, repo, worktrees } = setup();
  try {
    git(repo, "branch", "zeno/task-40");
    await prepareWorkdir(repo, 40, worktrees);
    assert.equal(readTaskBranchBase(worktrees, repo, "zeno/task-40"), undefined);
    assert.equal(existsSync(join(worktrees, ".branch-bases")), false);
    assert.equal((await zenoBranches(repo, worktrees))[0]!.baseSource, "estimated");
    git(repo, "symbolic-ref", "HEAD", "refs/heads/zeno/task-40");
    assert.equal((await zenoBranches(repo, worktrees))[0]!.baseSource, "unavailable");
    await assert.rejects(branchDiff(repo, "zeno/task-40", 200_000, worktrees), /No saved starting point/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("damaged saved facts refuse comparison instead of silently estimating; detached starts remain reviewable", async () => {
  const { root, repo, worktrees, sha } = setup();
  try {
    git(repo, "checkout", "--detach");
    await prepareWorkdir(repo, 42, worktrees);
    const [branch] = await zenoBranches(repo, worktrees);
    assert.equal(branch!.base, "detached HEAD"); assert.equal(branch!.baseSHA, sha); assert.equal(branch!.behind, undefined);
    const file = join(worktrees, ".branch-bases", readdirSync(join(worktrees, ".branch-bases"))[0]!);
    const saved = readFileSync(file, "utf8");
    for (const corrupt of ["{", saved.replace(sha, "a".repeat(40)), saved.replace('"branch":"atom/task-42"', '"branch":"atom/task-99"')]) {
      writeFileSync(file, corrupt);
      const [invalid] = await zenoBranches(repo, worktrees);
      assert.equal(invalid!.baseSource, "unavailable"); assert.match(invalid!.baseWarning!, /unavailable/);
      assert.deepEqual(invalid!.commits, []);
      await assert.rejects(branchDiff(repo, "atom/task-42", 200_000, worktrees));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("active root projects discover task branches without agent grants; revocation and subfolders do not expose the parent or enable push", async () => {
  const { root, repo, worktrees } = setup();
  const helpers = openHelperStore({ path: ":memory:", home: root, agentsDir: join(root, "agents") });
  let folders: string[] = [repo];
  const api = createIslandGit(helpers, { worktrees, projectFolders: () => folders });
  try {
    await prepareWorkdir(repo, 43, worktrees);
    assert.equal((await api.list())[0]!.branch, "atom/task-43");
    assert.equal((await api.list())[0]!.pushAllowed, false);
    assert.equal((await api.diff(repo, "atom/task-43")).text, "");
    await assert.rejects(api.push(repo, "atom/task-43"), /not in a folder you granted/);
    folders = [join(repo, "app")];
    assert.deepEqual(await api.list(), []);
    await assert.rejects(api.diff(repo, "atom/task-43"), /no longer/);
    folders = [repo];
    const pending = api.diff(repo, "atom/task-43"); folders = [];
    await assert.rejects(pending, /access changed|no longer/);
    assert.deepEqual(await api.list(), []);
    let checks = 0;
    const revokedDuringRead = createIslandGit(helpers, { worktrees, projectFolders: () => ++checks < 3 ? [repo] : [] });
    await assert.rejects(revokedDuringRead.diff(repo, "atom/task-43"), /access changed/);
  } finally { helpers.close(); rmSync(root, { recursive: true, force: true }); }
});
