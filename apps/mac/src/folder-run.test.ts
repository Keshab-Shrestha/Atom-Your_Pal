import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { denyRead, folderCheck } from "./folder-run.ts";

// Task 3.11: every tool call of a run in folders, checked in code; risky commands ask on Wisp's card.

test("paths outside are refused, risky commands ask, refused ones never ask; the log keeps verdicts only", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "zeno-run-")));
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
    assert.match((await check("Write", { file_path: join(root, ".git") }))!, /ZENO commits the work/);
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
