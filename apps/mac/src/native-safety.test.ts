import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@atom/helpers";
import { boardRecorder } from "./native-board.ts";
import { nativeGate, type NativeGate } from "./native-safety.ts";

type Decision = { decision: string; reason?: string; input?: Record<string, any> };

function setup(options: { project?: boolean; approve?: boolean } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-safety-")));
  const work = join(home, "work");
  mkdirSync(work);
  const store = openHelperStore({ path: ":memory:", home });
  store.addGrant("kame", work);
  const asked: string[] = [];
  const board = boardRecorder(store, "chat-1");
  const tools = [...(options.project ? ["Read", "Glob", "Grep"] : ["WebSearch", "WebFetch"]), "Agent"];
  const gate = nativeGate({
    tools,
    team: {
      chatId: "chat-1",
      helpers: store,
      board,
      approve: async (r) => (asked.push(r.summary), options.approve ?? false),
      chooseModel: async () => "haiku",
      worktrees: join(home, "worktrees"),
      ...(options.project ? { project: { cwd: work } } : {}),
    },
  });
  return { home, work, store, board, gate, asked, done: () => (store.close(), rmSync(home, { recursive: true, force: true })) };
}

async function pre(gate: NativeGate, hook: Record<string, unknown>, id = "call-1"): Promise<Decision> {
  const entry = (gate.hooks.PreToolUse as { hooks: ((h: unknown, id: string) => Promise<any>)[] }[])[0]!;
  const out = (await entry.hooks[0]!(hook, id)).hookSpecificOutput;
  return { decision: out.permissionDecision, reason: out.permissionDecisionReason, input: out.updatedInput };
}
const sub = (agent: string, tool_name: string, tool_input: Record<string, unknown>) => ({ agent_id: `a-${agent}`, agent_type: agent, tool_name, tool_input });

test("main thread: general-purpose and unknown agents are denied; one of ATOM's gets a running Board job and Laya's model", async () => {
  const { gate, store, done } = setup();
  assert.equal((await pre(gate, { tool_name: "Agent", tool_input: { prompt: "x", description: "d" } })).decision, "deny", "no subagent_type is general-purpose");
  assert.equal((await pre(gate, { tool_name: "Agent", tool_input: { prompt: "x", description: "d", subagent_type: "general-purpose" } }, "c2")).decision, "deny");
  assert.equal((await pre(gate, { tool_name: "Agent", tool_input: { prompt: "x", description: "d", subagent_type: "Explore" } }, "c3")).decision, "deny");
  const ok = await pre(gate, { tool_name: "Agent", tool_input: { prompt: "Find flights", description: "Flights", subagent_type: "sid", model: "opus", isolation: "remote" } }, "c4");
  assert.equal(ok.decision, "allow");
  assert.equal(ok.input!.model, "haiku", "Laya's tier, not the main agent's choice");
  assert.equal(ok.input!.isolation, undefined, "never remote");
  assert.equal(ok.input!.run_in_background, true);
  const job = store.list().find((h) => h.id === "sid")!.jobs[0]!;
  assert.equal(job.state, "running");
  assert.equal(job.chatId, "chat-1");
  // The same call again (canUseTool after the hook): one decision, one job.
  await gate.canUseTool("Agent", { prompt: "Find flights", subagent_type: "sid" }, { toolUseID: "c4" });
  assert.equal(store.list().find((h) => h.id === "sid")!.jobs.length, 1);
  store.pin("sid", "claude-opus-5-5");
  const pinned = await pre(gate, { tool_name: "Agent", tool_input: { prompt: "y", description: "d", subagent_type: "sid", model: "haiku" } }, "c5");
  assert.equal(pinned.input!.model, undefined, "a pin wins: the definition's model stands");
  done();
});

test("sub-agents: the kit decides; a research agent cannot write; Bash is denied in a plain chat", async () => {
  const { gate, work, done } = setup();
  assert.equal((await pre(gate, sub("sid", "WebSearch", { query: "q" }))).decision, "allow");
  const write = await pre(gate, sub("sid", "Write", { file_path: join(work, "a.txt"), content: "x" }), "c2");
  assert.equal(write.decision, "deny");
  assert.match(write.reason!, /not in Sid's kit/);
  const bash = await pre(gate, sub("kame", "Bash", { command: "ls" }), "c3");
  assert.equal(bash.decision, "deny");
  assert.match(bash.reason!, /only in a project chat/);
  assert.equal((await pre(gate, sub("kame", "Agent", { prompt: "x", subagent_type: "sid" }), "c4")).decision, "deny", "no agent spawns agents");
  done();
});

test("sub-agents: files only inside the agent's grants", async () => {
  const { gate, work, home, done } = setup();
  assert.equal((await pre(gate, sub("kame", "Write", { file_path: join(work, "a.txt"), content: "x" }))).decision, "allow");
  const outside = await pre(gate, sub("kame", "Write", { file_path: join(home, "elsewhere.txt"), content: "x" }), "c2");
  assert.equal(outside.decision, "deny");
  assert.equal((await pre(gate, sub("kame", "Read", { file_path: "/etc/hosts" }), "c3")).decision, "deny");
  done();
});

test("project chat: Bash runs sandboxed after the code check; a risky command asks Keshab; no unsandboxed command", async () => {
  const { gate, asked, done } = setup({ project: true });
  assert.equal((await pre(gate, sub("kame", "Bash", { command: "ls -la" }))).decision, "allow");
  assert.equal((await pre(gate, sub("kame", "Bash", { command: "ls", dangerouslyDisableSandbox: true }), "c2")).decision, "deny");
  assert.equal((await pre(gate, sub("kame", "Bash", { command: "git push origin main" }), "c3")).decision, "deny");
  const risky = await pre(gate, sub("kame", "Bash", { command: "rm -rf build" }), "c4");
  assert.equal(risky.decision, "deny", "Keshab said no on the card");
  assert.equal(asked.length, 1);
  // canUseTool for the same call id never asks again.
  await gate.canUseTool("Bash", { command: "rm -rf build" }, { toolUseID: "c4", agentID: "a-kame" });
  assert.equal(asked.length, 1);
  done();
});

test("project chat in a git repository: a folders agent works in a worktree on its task branch; its end commits there", async () => {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const { gate, work, store, board, done } = setup({ project: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "start");
  const call = await pre(gate, { tool_name: "Agent", tool_input: { prompt: "Fix it", description: "Fix", subagent_type: "kame" } }, "u1");
  assert.equal(call.input!.isolation, "worktree");
  const job = store.list().find((h) => h.id === "kame")!.jobs[0]!.id;
  const made = await (gate.hooks.WorktreeCreate as { hooks: (() => Promise<any>)[] }[])[0]!.hooks[0]!();
  const tree = made.hookSpecificOutput.worktreePath as string;
  assert.match(tree, new RegExp(`task-${job}`));
  board.onEvent({ type: "system", subtype: "task_started", task_id: "ag-1", tool_use_id: "u1" });
  // Inside the worktree: allowed (its roots are its grants plus its worktree).
  assert.equal((await pre(gate, { agent_id: "ag-1", agent_type: "kame", tool_name: "Write", tool_input: { file_path: join(tree, "a.txt"), content: "x" } }, "w1")).decision, "allow");
  writeFileSync(join(tree, "a.txt"), "x");
  await gate.agentEnded(job);
  assert.match(git("log", "--oneline", `atom/task-${job}`), new RegExp(`ATOM task ${job}`));
  git("worktree", "remove", "--force", tree);
  done();
});
