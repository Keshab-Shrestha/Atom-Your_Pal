import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@atom/helpers";
import { askForFolder, checkpointBefore, denyRead, folderCheck } from "./folder-run.ts";

// Task 3.11: every tool call of a run in folders, checked in code; risky commands ask on Pal's card.

test("paths outside are refused, risky commands ask, refused ones never ask; the log keeps verdicts only", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-run-")));
  try {
    const asked: string[] = [];
    let answer = true;
    const logged: unknown[] = [];
    const check = folderCheck({
      roots: [root],
      cwd: root,
      name: "Kame",
      approve: async (r) => (asked.push(r.summary), answer),
      onCheck: (e) => logged.push(e),
    });
    assert.equal(await check("Edit", { file_path: join(root, "a.ts") }), undefined);
    assert.match((await check("Read", { file_path: "/etc/passwd" }))!, /outside the folders/);
    assert.match((await check("Write", { file_path: join(root, ".git") }))!, /ATOM commits the work/);
    assert.match((await check("Bash", { command: "git push" }))!, /never done/);
    assert.equal(await check("Bash", { command: "rm -rf build" }), undefined, "asked, and allowed");
    answer = false;
    assert.match((await check("Bash", { command: "npm install x" }))!, /did not allow/);
    assert.deepEqual(asked, ["Kame wants to run: rm -rf build", "Kame wants to run: npm install x"]);
    assert.deepEqual(logged.map((e) => (e as { verdict: string }).verdict), ["allowed", "refused", "refused", "refused", "asked", "allowed", "asked", "declined"]);
    assert.ok(!JSON.stringify(logged).includes("passwd") && !JSON.stringify(logged).includes("npm"), "no paths or commands in the log");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sandboxed commands cannot read keys and tokens", () => {
  const paths = denyRead("/Users/k");
  for (const p of ["/Users/k/.ssh", "/Users/k/.aws", "/Users/k/Library/Keychains", "/Users/k/.claude"]) assert.ok(paths.includes(p), p);
});

// ADR-090: Quill had no folder, ran without file tools and could not save. Now it asks for the folder its task names.
test("a file worker with no folder asks for the one its task names; allowed, it is made and granted", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-home-")));
  try {
    const store = openHelperStore({ path: ":memory:", home });
    const asked: string[] = [];
    const task = "Save it as a text document in a folder named ZenoDoc in the user's home directory.";
    const grants = await askForFolder({
      task,
      name: "Quill",
      home,
      approve: async (r) => (asked.push(`${r.summary} | ${r.reason}`), true),
      grant: (folder) => (store.addGrant("quill", folder), store.list().find((h) => h.id === "quill")!.grants),
    });
    assert.deepEqual(grants, [join(home, "ZenoDoc")]);
    assert.ok(existsSync(join(home, "ZenoDoc")));
    assert.match(asked[0]!, /^Quill needs a folder to save files in \| .*~\/ZenoDoc/);
    // Said no (or no answer): a clear error, nothing made.
    await assert.rejects(
      askForFolder({ task: "Save it to ~/Other", name: "Kame", home, approve: async () => false, grant: () => [] }),
      /Kame needs a folder to save files in, and none was allowed/,
    );
    assert.ok(!existsSync(join(home, "Other")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// B3.4: the before-hook runs for tools that change files, after the checks pass, and never fails the run.
test("before runs only for file-changing tools whose paths passed; a throw does not fail the call", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-run-")));
  try {
    const seen: [string, string[]][] = [];
    const failed: string[] = [];
    let boom = false;
    const check = folderCheck({
      roots: [root],
      cwd: root,
      name: "Kame",
      approve: async () => true,
      before: (tool, paths) => {
        seen.push([tool, paths]);
        if (boom) throw new Error("disk full");
      },
      onBeforeError: (e) => failed.push(e.tool),
    });
    assert.equal(await check("Write", { file_path: join(root, "a.ts") }), undefined);
    assert.equal(await check("Edit", { file_path: "rel.ts" }), undefined, "a relative path is made absolute");
    assert.equal(await check("MultiEdit", { file_path: join(root, "m.ts") }), undefined);
    assert.equal(await check("NotebookEdit", { notebook_path: join(root, "n.ipynb") }), undefined);
    assert.equal(await check("Read", { file_path: join(root, "a.ts") }), undefined);
    assert.equal(await check("Grep", { pattern: "x", path: root }), undefined);
    assert.equal(await check("Bash", { command: "ls" }), undefined);
    assert.match((await check("Write", { file_path: "/etc/passwd" }))!, /outside the folders/);
    assert.match((await check("Write", { file_path: join(root, ".git", "x") }))!, /ATOM commits the work/);
    assert.deepEqual(seen, [
      ["Write", [join(root, "a.ts")]],
      ["Edit", [join(root, "rel.ts")]],
      ["MultiEdit", [join(root, "m.ts")]],
      ["NotebookEdit", [join(root, "n.ipynb")]],
    ]);
    boom = true;
    assert.equal(await check("Write", { file_path: join(root, "b.ts") }), undefined, "the call is still allowed");
    assert.deepEqual(failed, ["Write"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkpointBefore keeps files outside the git worktree and leaves the worktree to git", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atom-run-")));
  try {
    const tree = join(root, "tree");
    const other = join(root, "other");
    mkdirSync(tree);
    mkdirSync(other);
    const kept: string[] = [];
    const before = checkpointBefore({ roots: [tree, other], tree, keep: (_roots, p) => kept.push(p) });
    before("Write", [join(tree, "a.ts"), join(tree, "sub", "b.ts"), join(other, "c.ts")]);
    assert.deepEqual(kept, [join(other, "c.ts")]);
    kept.length = 0;
    checkpointBefore({ roots: [other], keep: (_roots, p) => kept.push(p) })("Edit", [join(other, "d.ts")]);
    assert.deepEqual(kept, [join(other, "d.ts")], "no worktree: every path is kept");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
