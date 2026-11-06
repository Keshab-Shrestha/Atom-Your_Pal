import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@ark/helpers";
import { boardRecorder } from "./native-board.ts";
import { planBook } from "./native-plan.ts";
import { nativeGate, type NativeGate } from "./native-safety.ts";
import { MAX_TEAM_CHILDREN } from "./org.ts";

/** ADR-272: work through managers (A1), agents that call agents (B1), the same agent many times at once (C). Fixtures only. */

type Decision = { decision: string; reason?: string; input?: Record<string, any> };

function setup(options: { reportsTo?: Record<string, string>; project?: "repo" | "folder"; plans?: boolean; chooseModel?: () => Promise<string | undefined> } = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ark-team-")));
  const work = join(home, "work");
  mkdirSync(work);
  if (options.project === "repo") {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: work, encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(work, "a.txt"), "old");
    git("add", "a.txt");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "start");
  }
  const store = openHelperStore({ path: ":memory:", home });
  const board = boardRecorder(store, "chat-1");
  const events: { event: string; fields: Record<string, unknown> }[] = [];
  const gate = nativeGate({
    tools: ["WebSearch", "WebFetch", "Agent"],
    team: {
      chatId: "chat-1",
      helpers: store,
      board,
      approve: async () => false,
      worktrees: join(home, "worktrees"),
      home,
      log: (event, fields) => void events.push({ event, fields }),
      ...(options.reportsTo ? { reportsTo: () => options.reportsTo! } : {}),
      ...(options.chooseModel ? { chooseModel: options.chooseModel } : {}),
      ...(options.project ? { project: { cwd: work } } : {}),
      ...(options.plans ? { plans: planBook(store, "chat-1", undefined, options.project ? { projectRoot: work } : {}) } : {}),
    },
  });
  const done = () => {
    store.close();
    rmSync(home, { recursive: true, force: true });
  };
  return { home, work, store, board, gate, events, done };
}

async function pre(gate: NativeGate, hook: Record<string, unknown>, id: string): Promise<Decision> {
  const entry = (gate.hooks.PreToolUse as { hooks: ((h: unknown, id: string) => Promise<any>)[] }[])[0]!;
  const out = (await entry.hooks[0]!(hook, id)).hookSpecificOutput;
  return { decision: out.permissionDecision, reason: out.permissionDecisionReason, input: out.updatedInput };
}
const ask = (subagent_type: string, extra: Record<string, unknown> = {}) => ({ tool_name: "Agent", tool_input: { subagent_type, prompt: "Do the part", description: "Part", ...extra } });
/** The newest job of an agent. */
const jobOf = (store: ReturnType<typeof openHelperStore>, helper: string) => store.list().find((h) => h.id === helper)!.jobs.reduce((a, b) => (b.id > a.id ? b : a));

/** The main thread starts `helper`; the SDK links the task to agent id `agent`. Returns the job id. */
async function start(t: ReturnType<typeof setup>, helper: string, agent: string, call = `m-${agent}`) {
  const v = await pre(t.gate, ask(helper), call);
  assert.equal(v.decision, "allow", v.reason);
  t.board.onEvent({ type: "system", subtype: "task_started", task_id: agent, tool_use_id: call });
  return jobOf(t.store, helper).id;
}
/** Agent `agent` (of type `helper`) calls `target`; on allow the SDK links the child to `child`. */
async function delegate(t: ReturnType<typeof setup>, agent: string, helper: string, target: string, child?: string, call = `n-${agent}-${child ?? target}`) {
  const v = await pre(t.gate, { agent_id: agent, agent_type: helper, ...ask(target) }, call);
  if (v.decision === "allow" && child) t.board.onEvent({ type: "system", subtype: "task_started", task_id: child, tool_use_id: call });
  return v;
}

test("A1: work for an agent with a lead goes through the lead, unless the user named the agent; ARK's own reports take work directly", async () => {
  const t = setup({ reportsTo: { kame: "sid" } });
  const direct = await pre(t.gate, ask("kame"), "c1");
  assert.equal(direct.decision, "deny");
  assert.equal(direct.reason, 'Kame reports to Sid. Give the task to Sid (subagent_type "sid"); Sid assigns it.');
  assert.equal(t.store.list().find((h) => h.id === "kame")!.jobs.length, 0, "no Board job for a refused call");
  assert.equal((await pre(t.gate, ask("penny"), "c2")).decision, "allow", "Penny reports to ARK");
  // Through the lead: Sid gets the task and hands the part to Kame.
  const sid = await start(t, "sid", "ag-sid", "c3");
  assert.equal((await delegate(t, "ag-sid", "sid", "kame", "ag-kame")).decision, "allow");
  assert.equal(jobOf(t.store, "kame").parentId, sid);
  // The user spoke to Kame by name: this answer may call Kame directly. The next answer may not.
  t.gate.newAnswer(undefined, "kame");
  assert.equal((await pre(t.gate, ask("kame"), "c4")).decision, "allow");
  t.gate.newAnswer(undefined);
  assert.equal((await pre(t.gate, ask("kame"), "c5")).decision, "deny");
  t.done();
});

test("B1: an agent calls its report or peer; the child runs in the foreground under its job, with only the safe fields", async () => {
  const t = setup({ reportsTo: { kame: "sid", puff: "sid", quill: "penny" } });
  const sid = await start(t, "sid", "ag-sid");
  const v = await pre(t.gate, { agent_id: "ag-sid", agent_type: "sid", ...ask("kame", { name: "boss", team_name: "t", mode: "bypassPermissions", run_in_background: true }) }, "n1");
  assert.equal(v.decision, "allow");
  assert.deepEqual(v.input, { subagent_type: "kame", prompt: "Do the part", description: "Part", run_in_background: false },
    "no name (SendMessage address), team or mode; the caller waits for the report");
  const child = jobOf(t.store, "kame");
  assert.equal(child.parentId, sid, "the Board draws it inside its parent's envelope");
  assert.equal(child.state, "running");
  assert.equal((await delegate(t, "ag-sid", "sid", "penny")).decision, "allow", "a peer: both report to ARK");
  // Ghostex rule: a child reports only by ending its turn. It has no tool to message its caller or ARK.
  t.board.onEvent({ type: "system", subtype: "task_started", task_id: "ag-kame", tool_use_id: "n1" });
  for (const [i, tool] of ["SendMessage", "mcp__ark__ask_user", "mcp__ark__notify", "TaskCreate"].entries()) {
    assert.equal((await pre(t.gate, { agent_id: "ag-kame", agent_type: "kame", tool_name: tool, tool_input: { to: "sid", message: "hi" } }, `g${i}`)).decision, "deny", tool);
  }
  t.done();
});

test("B1: refusals for a target that is not a report or peer, an upward call, a loop, depth 5, the 7th child and a paused agent", async () => {
  const t = setup({ reportsTo: { kame: "sid", puff: "sid", quill: "penny" } });
  await start(t, "sid", "ag-sid");
  const stranger = await delegate(t, "ag-sid", "sid", "quill");
  assert.equal(stranger.decision, "deny");
  assert.match(stranger.reason!, /^Quill is not one of your reports or peers\. You may call: Kame \(kame\), Puff \(puff\), Hana \(hana\), Penny \(penny\)\./);
  assert.equal((await delegate(t, "ag-sid", "sid", "sid")).reason, "You cannot give a task to yourself. Do the work, or end your turn with your report.");
  assert.equal((await delegate(t, "ag-sid", "sid", "kame", "ag-kame")).decision, "allow");
  assert.match((await delegate(t, "ag-kame", "kame", "sid")).reason!, /^Sid is above you in the team\. Do not call up/);
  // A loop between peers: Penny -> Hana -> Penny.
  const peers = setup();
  await start(peers, "penny", "ag-penny");
  assert.equal((await delegate(peers, "ag-penny", "penny", "hana", "ag-hana")).decision, "allow");
  assert.match((await delegate(peers, "ag-hana", "hana", "penny")).reason!, /^Penny already works on this task above you/);
  // Depth: with no chart all agents are peers; a chain of four may not start a fifth level.
  const chain = [["hana", "ag-hana"], ["sid", "ag-sid"], ["kame", "ag-kame"]] as const;
  let caller: readonly [string, string] = ["hana", "ag-hana"];
  for (const next of chain.slice(1)) {
    assert.equal((await delegate(peers, caller[1], caller[0], next[0], next[1])).decision, "allow", next[0]);
    caller = next;
  }
  const deep = await delegate(peers, "ag-kame", "kame", "puff");
  assert.equal(deep.decision, "deny");
  assert.match(deep.reason!, /^This task is 4 levels deep already\./);
  peers.done();
  // At most six agents below one root task, at every level together.
  const many = setup();
  await start(many, "penny", "ag-penny");
  for (let i = 0; i < MAX_TEAM_CHILDREN; i++) assert.equal((await delegate(many, "ag-penny", "penny", "sid", undefined, `k${i}`)).decision, "allow", `child ${i + 1}`);
  assert.match((await delegate(many, "ag-penny", "penny", "sid", undefined, "k7")).reason!, /^This task already started 6 agents below it\./);
  many.store.setPaused("hana", true);
  assert.match((await delegate(many, "ag-penny", "penny", "hana", undefined, "k8")).reason!, /^Hana is paused/);
  many.done();
  // An agent ARK cannot link to a task may not delegate.
  assert.match((await delegate(t, "ag-ghost", "puff", "kame")).reason!, /^ARK cannot link this call to your task/);
  t.done();
});

test("B1: a child inherits its caller's taint; its own reading taints its caller, not the main thread", async () => {
  const t = setup();
  await start(t, "sid", "ag-sid");
  const long = `https://example.com/page?q=${"x".repeat(100)}`;
  t.gate.webRead("ag-sid", "https://example.com");
  assert.equal((await delegate(t, "ag-sid", "sid", "penny", "ag-penny")).decision, "allow");
  const fetch = await pre(t.gate, { agent_id: "ag-penny", agent_type: "penny", tool_name: "WebFetch", tool_input: { url: long, prompt: "p" } }, "f1");
  assert.equal(fetch.decision, "deny", "the caller read web text before it called: the child is tainted too");
  // A clean caller: the child's reading goes up to the caller when it ends, and only the caller's end reaches the main thread.
  const c = setup();
  const parent = await start(c, "sid", "ag-sid");
  assert.equal((await delegate(c, "ag-sid", "sid", "penny", "ag-penny")).decision, "allow");
  const child = jobOf(c.store, "penny").id;
  c.gate.webRead("ag-penny", "https://example.com");
  await c.gate.agentEnded(child);
  assert.equal((await pre(c.gate, { tool_name: "mcp__ark__remember", tool_input: { text: "x" } }, "r1")).decision, "allow", "the main thread is not tainted yet");
  assert.equal((await pre(c.gate, { agent_id: "ag-sid", agent_type: "sid", tool_name: "WebFetch", tool_input: { url: long, prompt: "p" } }, "f2")).decision, "deny", "the caller is");
  await c.gate.agentEnded(parent);
  assert.equal((await pre(c.gate, { tool_name: "mcp__ark__remember", tool_input: { text: "x" } }, "r2")).decision, "deny");
  t.done();
  c.done();
});

test("B1: stopping a parent task stops its delegated children and theirs", async () => {
  const t = setup();
  const root = await start(t, "sid", "ag-sid");
  assert.equal((await delegate(t, "ag-sid", "sid", "penny", "ag-penny")).decision, "allow");
  assert.equal((await delegate(t, "ag-penny", "penny", "hana", "ag-hana")).decision, "allow");
  const child = jobOf(t.store, "penny").id, grandchild = jobOf(t.store, "hana").id;
  assert.equal(t.store.get(grandchild)!.parentId, child);
  t.store.stop(root);
  assert.equal(t.store.get(child)!.state, "stopped");
  assert.equal(t.store.get(grandchild)!.state, "stopped");
  t.done();
});

test("C: one agent runs twice at once in its own worktrees; home-folder file work still waits its turn", async () => {
  const iso = setup({ project: "repo", plans: true });
  const a = await pre(iso.gate, ask("kame"), "u1");
  const b = await pre(iso.gate, ask("kame"), "u2");
  assert.equal(a.decision, "allow", a.reason);
  assert.equal(b.decision, "allow", b.reason);
  assert.equal(a.input!.isolation, "worktree");
  assert.equal(b.input!.isolation, "worktree");
  iso.done();
  const shared = setup({ project: "folder", plans: true });
  assert.equal((await pre(shared.gate, ask("kame"), "u1")).decision, "allow");
  const held = await pre(shared.gate, ask("kame"), "u2");
  assert.equal(held.decision, "deny");
  assert.match(held.reason!, /File work is already running/);
  shared.done();
});

test("C: worktrees go to the jobs whose agents work in them, also when the creates come in the other order", async () => {
  const t = setup({ project: "repo" });
  assert.equal((await pre(t.gate, ask("kame"), "u1")).decision, "allow");
  const first = jobOf(t.store, "kame").id;
  assert.equal((await pre(t.gate, ask("kame"), "u2")).decision, "allow");
  const second = jobOf(t.store, "kame").id;
  const create = (t.gate.hooks.WorktreeCreate as { hooks: ((input: Record<string, unknown>) => Promise<any>)[] }[])[0]!.hooks[0]!;
  // The second call's agent asks first: FIFO gives it the first job's worktree.
  const treeOfTwo = (await create({ name: "agent-a2" })).hookSpecificOutput.worktreePath as string;
  const treeOfOne = (await create({ name: "agent-a1" })).hookSpecificOutput.worktreePath as string;
  assert.match(treeOfTwo, new RegExp(`task-${first}`));
  t.board.onEvent({ type: "system", subtype: "task_started", task_id: "a1", tool_use_id: "u1" });
  t.board.onEvent({ type: "system", subtype: "task_started", task_id: "a2", tool_use_id: "u2" });
  // Changing a file that exists is free only in the task's own worktree; anywhere else it asks (and the answer here is no).
  const edit = (agent: string, tree: string, id: string) => pre(t.gate, { agent_id: agent, agent_type: "kame", tool_name: "Edit", tool_input: { file_path: join(tree, "a.txt"), old_string: "old", new_string: "new" } }, id);
  assert.equal((await edit("a2", treeOfTwo, "e1")).decision, "allow", "agent 2 edits in the worktree it works in");
  assert.equal((await edit("a1", treeOfOne, "e2")).decision, "allow", "agent 1 too");
  assert.equal((await edit("a1", treeOfTwo, "e3")).decision, "deny", "not in the other agent's worktree");
  assert.ok(t.events.some((e) => e.event === "agent.worktree_swapped"));
  // A host adapter names its job: it gets exactly that job's worktree.
  assert.equal((await pre(t.gate, ask("kame"), "u3")).decision, "allow");
  const third = jobOf(t.store, "kame").id;
  assert.equal((await pre(t.gate, ask("kame"), "u4")).decision, "allow");
  const fourth = jobOf(t.store, "kame").id;
  assert.match((await create({ name: `ark-job-${fourth}` })).hookSpecificOutput.worktreePath, new RegExp(`task-${fourth}`));
  assert.match((await create({ name: `ark-job-${third}` })).hookSpecificOutput.worktreePath, new RegExp(`task-${third}`));
  for (const tree of [treeOfOne, treeOfTwo]) execFileSync("git", ["worktree", "remove", "--force", tree], { cwd: t.work });
  assert.notEqual(first, second);
  t.done();
});

test("C: before the SDK links two runs of one agent, ARK does not guess which task a call belongs to", async () => {
  const t = setup();
  assert.equal((await pre(t.gate, ask("sid"), "u1")).decision, "allow");
  assert.equal((await pre(t.gate, ask("sid"), "u2")).decision, "allow");
  const early = await pre(t.gate, { agent_id: "s1", agent_type: "sid", tool_name: "WebSearch", tool_input: { query: "q" } }, "w1");
  assert.equal(early.decision, "deny");
  assert.match(early.reason!, /cannot yet tell which of this agent's tasks/);
  t.board.onEvent({ type: "system", subtype: "task_started", task_id: "s1", tool_use_id: "u1" });
  t.board.onEvent({ type: "system", subtype: "task_started", task_id: "s2", tool_use_id: "u2" });
  assert.equal((await pre(t.gate, { agent_id: "s1", agent_type: "sid", tool_name: "WebSearch", tool_input: { query: "q" } }, "w2")).decision, "allow");
  assert.equal(t.board.jobOfAgent("s2"), jobOf(t.store, "sid").id);
  t.done();
});

test("B1: parallel calls cannot pass the six-child cap while the model choice is pending (checker, 2026-11-06)", async () => {
  // Production always chooses a model (Laya), and that await sits between the cap check and the Board job.
  const t = setup({ chooseModel: () => new Promise((resolve) => setTimeout(() => resolve("haiku"), 20)) });
  await start(t, "penny", "ag-penny");
  const verdicts = await Promise.all(Array.from({ length: 10 }, (_, i) => delegate(t, "ag-penny", "penny", "sid", undefined, `p${i}`)));
  assert.equal(verdicts.filter((v) => v.decision === "allow").length, MAX_TEAM_CHILDREN);
  assert.equal(t.store.list().find((h) => h.id === "sid")!.jobs.length, MAX_TEAM_CHILDREN);
  t.done();
  // A call refused after the cap check (here: the parent stopped during the model choice) gives its slot back.
  const u = setup({ chooseModel: () => new Promise((resolve) => setTimeout(() => resolve("haiku"), 20)) });
  const root = await start(u, "penny", "ag-penny");
  const late = delegate(u, "ag-penny", "penny", "sid", undefined, "q0");
  u.gate.cancelJob(root);
  assert.equal((await late).decision, "deny");
  assert.equal(u.store.list().find((h) => h.id === "sid")!.jobs.length, 0);
  u.done();
});

test("C: a swap before the other agent's worktree exists keeps both agents in their own worktrees (checker, 2026-11-06)", async () => {
  const t = setup({ project: "repo" });
  assert.equal((await pre(t.gate, ask("kame"), "u1")).decision, "allow");
  const first = jobOf(t.store, "kame").id;
  assert.equal((await pre(t.gate, ask("kame"), "u2")).decision, "allow");
  const second = jobOf(t.store, "kame").id;
  t.board.onEvent({ type: "system", subtype: "task_started", task_id: "a1", tool_use_id: "u1" });
  t.board.onEvent({ type: "system", subtype: "task_started", task_id: "a2", tool_use_id: "u2" });
  const create = (t.gate.hooks.WorktreeCreate as { hooks: ((input: Record<string, unknown>) => Promise<any>)[] }[])[0]!.hooks[0]!;
  const edit = (agent: string, tree: string, id: string) => pre(t.gate, { agent_id: agent, agent_type: "kame", tool_name: "Edit", tool_input: { file_path: join(tree, "a.txt"), old_string: "old", new_string: "new" } }, id);
  // Agent 2 creates first (FIFO gives it the first job's folder) and edits before agent 1 has a worktree.
  const treeOfTwo = (await create({ name: "agent-a2" })).hookSpecificOutput.worktreePath as string;
  assert.match(treeOfTwo, new RegExp(`task-${first}`));
  assert.equal((await edit("a2", treeOfTwo, "e1")).decision, "allow");
  const treeOfOne = (await create({ name: "agent-a1" })).hookSpecificOutput.worktreePath as string;
  assert.notEqual(treeOfOne, treeOfTwo, "agent 1 gets a new folder, not agent 2's");
  assert.match(treeOfOne, new RegExp(`task-${second}`));
  assert.equal((await edit("a1", treeOfOne, "e2")).decision, "allow");
  assert.equal((await edit("a2", treeOfTwo, "e3")).decision, "allow", "agent 2 still edits in its own worktree");
  assert.equal((await edit("a1", treeOfTwo, "e4")).decision, "deny");
  assert.equal((await edit("a2", treeOfOne, "e5")).decision, "deny");
  for (const tree of [treeOfOne, treeOfTwo]) execFileSync("git", ["worktree", "remove", "--force", tree], { cwd: t.work });
  t.done();
});
