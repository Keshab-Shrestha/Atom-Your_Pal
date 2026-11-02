import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTrashTool, moveToTrash } from "./trash-tool.ts";
import { TRASH_CALL, folderCheck } from "./folder-run.ts";

// 2026-11-01 (Keshab: "ask and give any permission, like Claude Code"; deletes go to the Trash). All on a temp folder: never the real Trash.

test("trash_file moves a file into the Trash under a free name, and refuses a whole home folder", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ark-trash-")));
  const trash = join(home, "Trash");
  try {
    mkdirSync(join(home, "Documents"));
    const a = join(home, "Documents", "draft.txt");
    writeFileSync(a, "one");
    const tool = createTrashTool({ home, trash });
    assert.match(await tool.run({ path: "~/Documents/draft.txt" }), /Moved ~\/Documents\/draft\.txt to the Trash \(draft\.txt\)/);
    assert.ok(!existsSync(a));
    writeFileSync(a, "two");
    assert.equal(moveToTrash(a, trash), join(trash, "draft 2.txt"), "a name already in the Trash gets a number");
    assert.equal(readFileSync(join(trash, "draft 2.txt"), "utf8"), "two");
    await assert.rejects(async () => tool.run({ path: home }), /whole home folder/);
    await assert.rejects(async () => tool.run({ path: join(home, "missing.txt") }), /does not exist/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("every delete asks; Deny keeps the file; Full access skips the question; a protected place asks first", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ark-trash-check-")));
  try {
    mkdirSync(join(home, "Documents")); writeFileSync(join(home, "Documents", "old.txt"), "x");
    const asked: string[] = [];
    let answer = false, full = false;
    const check = folderCheck({ roots: [], home, cwd: home, name: "Kame", fullAccess: () => full,
      approve: async (r) => (asked.push(r.summary), answer), approveFile: async (r) => (asked.push(r.summary), answer ? "once" as const : false) });
    assert.match((await check(TRASH_CALL, { path: join(home, "Documents", "old.txt") }))!, /did not allow this delete/);
    assert.deepEqual(asked, ["Kame wants to move ~/Documents/old.txt to the Trash"]);
    answer = true;
    assert.equal(await check(TRASH_CALL, { path: join(home, "Documents", "old.txt") }), undefined);
    asked.length = 0;
    assert.equal(await check(TRASH_CALL, { path: join(home, ".config", "x") }), undefined);
    assert.deepEqual(asked, ["Kame wants to change a protected file: ~/.config/x", "Kame wants to move ~/.config/x to the Trash"]);
    asked.length = 0; full = true;
    assert.equal(await check(TRASH_CALL, { path: join(home, ".config", "y") }), undefined);
    assert.deepEqual(asked, [], "Full access asks nothing (Keshab, 2026-11-01)");
    assert.match((await check(TRASH_CALL, {}))!, /Name the file/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
