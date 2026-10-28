import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openHelperStore } from "@atom/helpers";
import { openMemoryStore } from "@atom/memory";
import { nativeGate, type NativeGate } from "./native-safety.ts";
import { boardRecorder } from "./native-board.ts";
import { createComputerBridge } from "./computer-bridge.ts";
import { folderCheck } from "./folder-run.ts";

const pre = async (gate: NativeGate, agent: string, file: string, id: string) => {
  const hook = (gate.hooks.PreToolUse as any)[0].hooks[0];
  const out = await hook({ agent_id: agent, agent_type: "kame", tool_name: "Write", tool_input: { file_path: file, content: "changed" } }, id);
  if (out.hookSpecificOutput.permissionDecision === "allow") writeFileSync(file, "changed");
  return out.hookSpecificOutput.permissionDecision;
};

test("Stop between an approval answer and policy continuation cannot persist its continuing grant", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-stop-grant-race-")));
  const memory = openMemoryStore({ path: ":memory:" });
  const permissions = memory.filePermissions.forChat("chat");
  let stopped = false, checkpoints = 0;
  const file = join(home, "cedar.txt"); writeFileSync(file, "original");
  try {
    const check = folderCheck({ roots: [], cwd: home, home, name: "Kame", permissions, cancelled: () => stopped,
      before: () => { checkpoints++; }, approve: async () => false,
      approveFile: async () => { queueMicrotask(() => { stopped = true; }); return "chat"; } });
    assert.match((await check("Write", { file_path: file, content: "changed" }))!, /stopped/);
    assert.deepEqual(permissions.list(), []); assert.equal(checkpoints, 0);
    assert.equal(readFileSync(file, "utf8"), "original");
  } finally { memory.close(); rmSync(home, { recursive: true, force: true }); }
});

test("Stop closes only that task's file card, rejects late approval, and leaves another task's approval working", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-task-stop-")));
  const helpers = openHelperStore({ path: ":memory:", home });
  const memory = openMemoryStore({ path: ":memory:" });
  const bridge = createComputerBridge(); bridge.attach(() => {});
  const board = boardRecorder(helpers, "chat");
  const gate = nativeGate({ tools: ["Agent"], team: { helpers, board, chatId: "chat", home, worktrees: join(home, "worktrees"),
    approve: bridge.approve, approveFile: bridge.approveFile, permissions: memory.filePermissions.forChat("chat") } });
  try {
    const files = [join(home, "cedar.txt"), join(home, "other.txt")];
    files.forEach((f) => writeFileSync(f, "original"));
    const a = helpers.addNativeJob("kame", "Cedar", { chatId: "chat" }); board.opened("u-a", a.id, "Cedar");
    const first = pre(gate, "a", files[0]!, "w-a");
    await new Promise((r) => setImmediate(r));
    const firstId = bridge.pending()[0]!.id;
    const b = helpers.addNativeJob("kame", "Other", { chatId: "chat" }); board.opened("u-b", b.id, "Other");
    const second = pre(gate, "b", files[1]!, "w-b");
    await new Promise((r) => setImmediate(r));
    const secondId = bridge.pending().find((ask) => ask.id !== firstId)!.id;
    const read = await (gate.hooks.PreToolUse as any)[0].hooks[0]({ agent_id: "a", agent_type: "kame", tool_name: "Read", tool_input: { file_path: files[0] } }, "read-a");
    assert.equal(read.hookSpecificOutput.permissionDecision, "allow");
    helpers.stop(a.id); gate.cancelJob(a.id);
    assert.deepEqual(bridge.pending().map((ask) => ask.id), [secondId]);
    bridge.answer(firstId, true, true); // a delayed Allow for chat from the old card
    assert.equal(await first, "deny");
    assert.equal(readFileSync(files[0]!, "utf8"), "original");
    assert.deepEqual(memory.filePermissions.forChat("chat").list(), []);
    bridge.answer(secondId, true);
    assert.equal(await second, "allow");
    assert.equal(readFileSync(files[1]!, "utf8"), "changed");
    const again = await gate.canUseTool("Write", { file_path: files[0], content: "late" }, { agentID: "a", toolUseID: "w-a" });
    assert.equal(again.behavior, "deny", "a cached tool decision cannot restore a stopped task");
    const cachedRead = await gate.canUseTool("Read", { file_path: files[0] }, { agentID: "a", toolUseID: "read-a" });
    assert.equal(cachedRead.behavior, "deny", "a previously allowed cached decision is refused after Stop too");
  } finally { bridge.cancelAll(); helpers.close(); memory.close(); rmSync(home, { recursive: true, force: true }); }
});

test("a late approval adapter that ignores cancellation cannot create a grant or allow a write", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-late-approval-")));
  const helpers = openHelperStore({ path: ":memory:", home });
  const memory = openMemoryStore({ path: ":memory:" });
  const board = boardRecorder(helpers, "chat");
  let allow!: (choice: "chat") => void;
  const gate = nativeGate({ tools: ["Agent"], team: { helpers, board, chatId: "chat", home, worktrees: home,
    approve: async () => false, approveFile: () => new Promise((resolve) => { allow = resolve; }), permissions: memory.filePermissions.forChat("chat") } });
  try {
    const file = join(home, "cedar.txt"); writeFileSync(file, "original");
    const job = helpers.addNativeJob("kame", "Cedar", { chatId: "chat" }); board.opened("u", job.id, "Cedar");
    const pending = pre(gate, "a", file, "w"); await new Promise((r) => setImmediate(r));
    helpers.stop(job.id); gate.cancelJob(job.id);
    assert.equal(await pending, "deny", "cancellation settles before the adapter answers");
    allow("chat"); await new Promise((r) => setImmediate(r));
    assert.equal(readFileSync(file, "utf8"), "original");
    assert.deepEqual(memory.filePermissions.forChat("chat").list(), []);
  } finally { helpers.close(); memory.close(); rmSync(home, { recursive: true, force: true }); }
});
