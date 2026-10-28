import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectWorkspace, type WorkspaceAction } from "./project-workspace.ts";
import { gitFiles, gitFileReview, type GitSection } from "./git-review.ts";

const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-git-review-"))), root = join(home, "project"); mkdirSync(root);
  git(root, "init", "-b", "main");
  for (const path of ["note.txt", "staged.txt", "mixed.txt", "removed.txt", "renamed.txt", "conflict.txt"]) writeFileSync(join(root, path), "original\n");
  mkdirSync(join(root, "sub")); writeFileSync(join(root, "sub", "inside.txt"), "inside\n");
  writeFileSync(join(root, ".env"), "FICTIONAL_ONLY=true\n");
  git(root, "add", "."); git(root, "commit", "-m", "Fixture baseline");
  let active = true;
  const host = createProjectWorkspace({ home, project: (id) => active && id === "p" ? { folder: root, archived: false } : undefined });
  const read = (action: WorkspaceAction, path = "", section?: GitSection) => host.git({ type: "workspace", request: randomUUID(), chat: "c", project: "p", action, path, ...(section ? { section } : {}) });
  return { home, root, read, revoke: () => { active = false; }, close: () => rmSync(home, { recursive: true, force: true }) };
}

test("Git workspace lists staged/unstaged/untracked/renamed/deleted files and compares exact source without changing the index", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "note.txt"), "working\n"); writeFileSync(join(f.root, "staged.txt"), "staged\n");
    writeFileSync(join(f.root, "mixed.txt"), "index version\n"); git(f.root, "add", "staged.txt", "mixed.txt");
    writeFileSync(join(f.root, "mixed.txt"), "working version\n"); rmSync(join(f.root, "removed.txt"));
    git(f.root, "mv", "renamed.txt", "new name.txt"); writeFileSync(join(f.root, "untracked.txt"), "untracked\n");
    const index = readFileSync(join(f.root, ".git", "index"));
    const status = await f.read("git"); assert.equal(status.ok, true); assert.equal(status.gitStatus?.branch, "main");
    const files = status.gitStatus!.files;
    for (const [path, section] of [["note.txt", "unstaged"], ["staged.txt", "staged"], ["mixed.txt", "staged"], ["mixed.txt", "unstaged"], ["removed.txt", "unstaged"], ["new name.txt", "staged"], ["untracked.txt", "untracked"]]) assert.ok(files.some((file) => file.path === path && file.section === section), `${section} ${path}`);
    const staged = await f.read("gitReview", "mixed.txt", "staged"); assert.deepEqual([staged.gitReview?.before, staged.gitReview?.after], ["original\n", "index version\n"]);
    const working = await f.read("gitReview", "mixed.txt", "unstaged"); assert.deepEqual([working.gitReview?.before, working.gitReview?.after], ["index version\n", "working version\n"]);
    const renamed = await f.read("gitReview", "new name.txt", "staged"); assert.deepEqual([renamed.gitReview?.before, renamed.gitReview?.after], ["original\n", "original\n"]);
    const removed = await f.read("gitReview", "removed.txt", "unstaged"); assert.equal(removed.gitReview?.after, "");
    const untracked = await f.read("gitReview", "untracked.txt", "untracked"); assert.equal(untracked.gitReview?.before, "");
    assert.deepEqual(readFileSync(join(f.root, ".git", "index")), index);
    assert.equal(await f.read("gitReview", ".env", "staged").then((r) => r.ok), false);
  } finally { f.close(); }
});

test("Git review disables clean/process/textconv/diff commands and ignores inherited Git routing", async () => {
  const f = fixture(); const old = process.env.GIT_DIR;
  try {
    const marker = join(f.home, "EXECUTED");
    writeFileSync(join(f.root, ".gitattributes"), "note.txt filter=fixture diff=fixture\n");
    git(f.root, "config", "filter.fixture.clean", `touch '${marker}'; cat`);
    git(f.root, "config", "filter.fixture.process", `touch '${marker}'; cat`);
    git(f.root, "config", "filter.fixture.required", "true");
    git(f.root, "config", "diff.fixture.textconv", `touch '${marker}'`);
    git(f.root, "config", "diff.external", `touch '${marker}'`);
    writeFileSync(join(f.root, "note.txt"), "changed\n");
    process.env.GIT_DIR = join(f.home, "not-a-repository");
    const status = await f.read("git"); assert.equal(status.ok, true); assert.equal(status.gitStatus?.filtersDisabled, true);
    assert.equal((await f.read("gitReview", "note.txt", "unstaged")).gitReview?.after, "changed\n");
    assert.equal(existsSync(marker), false, "no configured program executes");
  } finally { if (old === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = old; f.close(); }
});

test("Git review handles unborn and detached branches and computes local upstream divergence", async () => {
  const f = fixture();
  try {
    git(f.root, "branch", "upstream"); git(f.root, "branch", "--set-upstream-to=upstream", "main");
    writeFileSync(join(f.root, "note.txt"), "ahead\n"); git(f.root, "commit", "-am", "ahead");
    let status = (await f.read("git")).gitStatus!; assert.deepEqual([status.ahead, status.behind], [1, 0]);
    git(f.root, "checkout", "--detach"); status = (await f.read("git")).gitStatus!; assert.match(status.branch, /^Detached /);
    git(f.root, "checkout", "--orphan", "empty"); git(f.root, "rm", "-rf", ".");
    writeFileSync(join(f.root, "fresh.txt"), "fresh\n");
    status = (await f.read("git")).gitStatus!; assert.equal(status.head, ""); assert.equal(status.branch, "empty");
    assert.equal((await f.read("gitReview", "fresh.txt", "untracked")).gitReview?.after, "fresh\n");
  } finally { f.close(); }
});

test("Git conflict review reads exact base/ours/theirs stages without resolving anything", async () => {
  const f = fixture();
  try {
    git(f.root, "checkout", "-b", "other"); writeFileSync(join(f.root, "conflict.txt"), "theirs\n"); git(f.root, "commit", "-am", "theirs");
    git(f.root, "checkout", "main"); writeFileSync(join(f.root, "conflict.txt"), "ours\n"); git(f.root, "commit", "-am", "ours");
    assert.throws(() => git(f.root, "merge", "other"));
    const before = readFileSync(join(f.root, "conflict.txt"), "utf8");
    const review = await f.read("gitReview", "conflict.txt", "conflict");
    assert.deepEqual([review.gitReview?.base, review.gitReview?.before, review.gitReview?.after], ["original\n", "ours\n", "theirs\n"]);
    assert.equal(readFileSync(join(f.root, "conflict.txt"), "utf8"), before);
    assert.match(git(f.root, "ls-files", "-u"), /conflict.txt/);
  } finally { f.close(); }
});

test("Git review stays inside a subfolder project and refuses links, oversize, invalid UTF-8 and revoked roots", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "sub", "inside.txt"), "changed inside\n"); writeFileSync(join(f.root, "note.txt"), "outside sub\n");
    const sub = createProjectWorkspace({ home: f.home, project: () => ({ folder: join(f.root, "sub"), archived: false }) });
    const request = { type: "workspace" as const, request: randomUUID(), chat: "c", project: "p", action: "git" as const, path: "" };
    const status = await sub.git(request); assert.deepEqual(status.gitStatus?.files.map((file) => file.path), ["inside.txt"]);
    assert.equal((await sub.git({ ...request, action: "gitReview", path: "inside.txt", section: "unstaged" })).gitReview?.before, "inside\n");
    writeFileSync(join(f.root, "large.txt"), "x".repeat(32769)); writeFileSync(join(f.root, "bad.txt"), Buffer.from([255]));
    symlinkSync(join(f.home, "outside"), join(f.root, "link.txt"));
    for (const name of ["large.txt", "bad.txt", "link.txt", "../outside"]) assert.equal((await f.read("gitReview", name, "untracked")).ok, false, name);
    f.revoke(); assert.equal((await f.read("git")).ok, false);
  } finally { f.close(); }
});

test("porcelain NUL parsing preserves spaces and bounds output; crossing rename boundaries are excluded", () => {
  const result = gitFiles("R  sub/new name\0outside/old\0 M sub/a file\0?? sub/new.txt\0", "sub/", () => true);
  assert.deepEqual(result.files.map((f) => f.path), ["a file", "new.txt"]);
  const many = gitFiles(Array.from({ length: 201 }, (_, i) => `?? f${i}\0`).join(""), "", () => true);
  assert.equal(many.files.length, 200); assert.equal(many.limited, true);
});

test("Git results are withheld when project access changes while the read is in flight", async () => {
  const f = fixture();
  try {
    const reading = f.read("git"); f.revoke();
    const result = await reading;
    assert.equal(result.ok, false); assert.equal(result.gitStatus, undefined);
  } finally { f.close(); }
});


test("an unstaged rename compares the original index entry with the destination working file", async () => {
  const f = fixture();
  try {
    renameSync(join(f.root, "note.txt"), join(f.root, "moved.txt")); writeFileSync(join(f.root, "moved.txt"), "moved and edited\n");
    const review = await gitFileReview(f.root, { path: "moved.txt", original: "note.txt", section: "unstaged", status: " R" }, (p) => !p.includes(".."));
    assert.deepEqual([review.before, review.after], ["original\n", "moved and edited\n"]);
  } finally { f.close(); }
});
