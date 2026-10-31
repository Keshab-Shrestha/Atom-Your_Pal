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
      home,
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
  assert.equal(job.model, "haiku", "Phase N3: the Board shows Laya's model at once");
  // The same call again (canUseTool after the hook): one decision, one job.
  await gate.canUseTool("Agent", { prompt: "Find flights", subagent_type: "sid" }, { toolUseID: "c4" });
  assert.equal(store.list().find((h) => h.id === "sid")!.jobs.length, 1);
  store.pin("sid", "claude-opus-5-5");
  const pinned = await pre(gate, { tool_name: "Agent", tool_input: { prompt: "y", description: "d", subagent_type: "sid", model: "haiku" } }, "c5");
  assert.equal(pinned.input!.model, undefined, "a pin wins: the definition's model stands");
  assert.equal(store.list().find((h) => h.id === "sid")!.jobs.find((j) => j.task === "y")!.model, "claude-opus-5-5", "the pin shows on the Board");
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

test("sub-agents (ADR-122, ADR-123): any agent writes a new file anywhere in home; changing a file that exists asks; the floor holds", async () => {
  const { gate, work, home, asked, done } = setup();
  // No grants are needed: a new file in a folder the agent was never given is saved at once.
  assert.equal((await pre(gate, sub("kame", "Write", { file_path: join(work, "a.txt"), content: "x" }))).decision, "allow");
  assert.equal((await pre(gate, sub("kame", "Write", { file_path: join(home, "Documents", "page.html"), content: "x" }), "c2")).decision, "allow");
  assert.equal(asked.length, 0);
  // A file that exists: Keshab is asked (his answer here is no).
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(home, "Documents"), { recursive: true });
  writeFileSync(join(home, "Documents", "old.txt"), "old");
  const edit = await pre(gate, sub("kame", "Edit", { file_path: join(home, "Documents", "old.txt"), old_string: "old", new_string: "new" }), "c3");
  assert.equal(edit.decision, "deny");
  assert.equal(asked.length, 1);
  // The floor, for every agent (here a second one, puff, a designer).
  for (const [agent, path] of [["kame", "/etc/hosts"], ["puff", join(home, ".ssh", "id_x")], ["puff", join(home, "Library", "x")], ["kame", join(home, "Documents", "passport.pdf")]] as const) {
    assert.equal((await pre(gate, sub(agent, "Read", { file_path: path }), `f-${path}`)).decision, "deny", `${agent} ${path}`);
  }
  assert.equal((await pre(gate, sub("puff", "Write", { file_path: join(home, "Desktop", "logo.svg"), content: "x" }), "p1")).decision, "allow", "puff has no grant either");
  done();
});

test("project chat: Bash runs sandboxed after the code check; a risky command asks Keshab; no unsandboxed command", async () => {
  const { gate, asked, done } = setup({ project: true });
  assert.equal((await pre(gate, sub("kame", "Bash", { command: "ls -la" }))).decision, "allow");
  assert.equal((await pre(gate, sub("kame", "Bash", { command: "ls", dangerouslyDisableSandbox: true }), "c2")).decision, "deny");
  assert.equal((await pre(gate, sub("kame", "Bash", { command: "git push origin main" }), "c3")).decision, "deny");
  const gone = await pre(gate, sub("kame", "Bash", { command: "rm -rf build" }), "c5");
  assert.equal(gone.decision, "deny", "deleting is refused with no card");
  assert.equal(asked.length, 0);
  const risky = await pre(gate, sub("kame", "Bash", { command: "npm install left-pad" }), "c4");
  assert.equal(risky.decision, "deny", "Keshab said no on the card");
  assert.equal(asked.length, 1);
  // canUseTool for the same call id never asks again.
  await gate.canUseTool("Bash", { command: "npm install left-pad" }, { toolUseID: "c4", agentID: "a-kame" });
  assert.equal(asked.length, 1);
  done();
});

test("project task completion retains uncommitted work without changing branch history", async () => {
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
  assert.equal(git("rev-parse", `atom/task-${job}`), git("rev-parse", "HEAD"));
  assert.equal(execFileSync("git", ["-C", tree, "status", "--porcelain"], { encoding: "utf8" }).trim(), "?? a.txt");
  git("worktree", "remove", "--force", tree);
  done();
});

test("main thread: an Agent call passes on only description, prompt, subagent_type and run_in_background", async () => {
  const { gate, done } = setup();
  const input = { prompt: "Find flights", description: "Flights", subagent_type: "sid", mode: "bypassPermissions", name: "boss", team_name: "t", effort: "max" };
  const ok = await pre(gate, { tool_name: "Agent", tool_input: input });
  assert.equal(ok.decision, "allow");
  assert.deepEqual(ok.input, { prompt: "Find flights", description: "Flights", subagent_type: "sid", run_in_background: true, model: "haiku" });
  done();
});

test("plan-first: no Write, Edit or Bash before Keshab approves the plan; approved, the agent may change files", async () => {
  const yes = setup({ project: true, approve: true });
  yes.store.setPlanFirst("kame", true);
  const write = { file_path: join(yes.work, "a.txt"), content: "x" };
  const before = await pre(yes.gate, sub("kame", "Write", write));
  assert.equal(before.decision, "deny");
  assert.match(before.reason!, /plans first/);
  assert.equal((await pre(yes.gate, sub("kame", "Bash", { command: "ls" }), "c2")).decision, "deny");
  assert.equal((await pre(yes.gate, sub("kame", "Read", { file_path: join(yes.work, "a.txt") }), "c3")).decision, "allow", "reading is planning");
  assert.equal((await pre(yes.gate, sub("kame", "ExitPlanMode", { plan: "Write a.txt" }), "c4")).decision, "allow");
  assert.equal((await pre(yes.gate, sub("kame", "Write", write), "c5")).decision, "allow");
  yes.done();

  const no = setup({ project: true, approve: false });
  no.store.setPlanFirst("kame", true);
  assert.equal((await pre(no.gate, sub("kame", "ExitPlanMode", { plan: "Write a.txt" }))).decision, "deny");
  assert.equal((await pre(no.gate, sub("kame", "Edit", { file_path: join(no.work, "a.txt"), old_string: "a", new_string: "b" }), "c2")).decision, "deny");
  assert.equal((await pre(no.gate, sub("kame", "Bash", { command: "ls" }), "c3")).decision, "deny", "a declined plan keeps them denied");
  no.done();
});

test("sub-agents: ToolSearch only for an agent with MCP servers or the browser", async () => {
  const { gate, store, done } = setup();
  assert.equal((await pre(gate, sub("sid", "ToolSearch", { query: "x" }))).decision, "deny");
  store.setBrowser("sid", true);
  assert.equal((await pre(gate, sub("sid", "ToolSearch", { query: "x" }), "c2")).decision, "allow");
  done();
});

test("fail closed: a decision that throws, an unknown agent, a missing agent type, TodoWrite on the main thread", async () => {
  const { gate, store, done } = setup();
  assert.equal((await pre(gate, { agent_id: "a-x", agent_type: "nobody", tool_name: "WebSearch", tool_input: {} })).decision, "deny");
  assert.equal((await pre(gate, { agent_id: "never-seen", tool_name: "WebSearch", tool_input: {} }, "c2")).decision, "deny", "no agent_type");
  assert.equal((await pre(gate, { tool_name: "TodoWrite", tool_input: { todos: [] } }, "c3")).decision, "deny");
  const broken = nativeGate({
    tools: ["Agent"],
    team: { chatId: "c", helpers: { ...store, list: () => { throw new Error("db gone"); } }, board: boardRecorder(store, "c"), approve: async () => true, worktrees: "/tmp" },
  });
  const thrown = await pre(broken, sub("sid", "WebSearch", { query: "q" }));
  assert.equal(thrown.decision, "deny");
  assert.match(thrown.reason!, /could not check/);
  done();
});

test("sub-agents: the skills an agent was given count as used by its task (they are preloaded), so a bad or failed task can ask for an edit to them", async () => {
  const { gate, store, done } = setup();
  store.setSkills("sid", ["trip-planning"]);
  await pre(gate, { tool_name: "Agent", tool_input: { prompt: "Find flights", description: "Flights", subagent_type: "sid" } });
  const job = store.list().find((h) => h.id === "sid")!.jobs[0]!.id;
  assert.deepEqual(store.skillsUsed(job), ["trip-planning"], "recorded when the task starts: the skill is already in the agent's context");
  assert.equal((await pre(gate, sub("sid", "Skill", { skill: "other" }), "c2")).decision, "deny", "not its skill");
  assert.deepEqual(store.skillsUsed(job), ["trip-planning"], "a refused skill is not a use");
  assert.equal((await pre(gate, sub("sid", "Skill", { skill: "trip-planning" }), "c3")).decision, "allow");
  assert.deepEqual(store.skillsUsed(job), ["trip-planning"], "calling the tool too records nothing twice");
  // An agent with no skills records none.
  await pre(gate, { tool_name: "Agent", tool_input: { prompt: "Find hotels", description: "Hotels", subagent_type: "kame" } }, "c4");
  const other = store.list().find((h) => h.id === "kame")!.jobs[0]!.id;
  assert.deepEqual(store.skillsUsed(other), []);
  done();
});

// 2026-10-16 (security review): WebFetch went through the main thread and sub-agents unchecked.
test("WebFetch is refused for a local address or an address that carries data, on the main thread and for a research agent", async () => {
  const s = setup();
  try {
    const mainBad = await pre(s.gate, { hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: "http://169.254.169.254/latest/meta-data/" } }, "w1");
    assert.equal(mainBad.decision, "deny");
    assert.match(mainBad.reason ?? "", /local or private/i);
    const mainLong = await pre(s.gate, { hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: `https://evil.test/?d=${"x".repeat(900)}` } }, "w2");
    assert.equal(mainLong.decision, "deny");
    const mainOk = await pre(s.gate, { hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: "https://en.wikipedia.org/wiki/Glacier" } }, "w3");
    assert.equal(mainOk.decision, "allow");
    // A research agent (Sid) goes through the same rule.
    const subBad = await pre(s.gate, sub("sid", "WebFetch", { url: "http://localhost:8080/admin" }), "w4");
    assert.equal(subBad.decision, "deny");
    assert.match(subBad.reason ?? "", /local or private/i);
    assert.equal((await pre(s.gate, sub("sid", "WebFetch", { url: "https://en.wikipedia.org/wiki/Glacier" }), "w5")).decision, "allow");
  } finally {
    s.done();
  }
});

// ADR-123: after web text, the main thread may not make anything that lasts or send data out; the user's next message clears it.
async function post(gate: NativeGate, hook: Record<string, unknown>) {
  const entries = gate.hooks.PostToolUse as { matcher?: string; hooks: ((h: unknown) => Promise<unknown>)[] }[];
  const entry = entries.find((e) => e.matcher && new RegExp(e.matcher).test(String(hook.tool_name)))!;
  await entry.hooks[0]!(hook);
}
test("taint: after the main thread read the web, create_agent, remember, open_url and the rest are refused until the user speaks", async () => {
  const { gate, done } = setup();
  const atomTool = (tool: string) => ({ tool_name: `mcp__atom__${tool}`, tool_input: { name: "x" } });
  assert.equal((await pre(gate, atomTool("create_agent"), "t1")).decision, "allow", "not tainted: the tool's own approval card applies");
  await post(gate, { tool_name: "WebFetch", tool_input: { url: "https://evil.example/page" } });
  for (const tool of ["create_agent", "propose_skill", "improve_skill", "open_url", "remember", "forget", "undo_memory_change", "brain_note", "schedule", "note_add"]) {
    const r = await pre(gate, atomTool(tool), `t-${tool}`);
    assert.equal(r.decision, "deny", tool);
    assert.match(r.reason!, /web text/);
  }
  assert.equal((await pre(gate, atomTool("weather"), "t-weather")).decision, "allow", "harmless tools stay");
  gate.newAnswer(undefined);
  assert.equal((await pre(gate, atomTool("create_agent"), "t-after")).decision, "allow", "the user's next message clears it");
  done();
});

test("taint: a sub-agent that read the web may fetch only short addresses; another agent is not tainted by it", async () => {
  const { gate, store, board, done } = setup();
  await pre(gate, { tool_name: "Agent", tool_input: { prompt: "x", description: "a", subagent_type: "sid" } }, "u1");
  await pre(gate, { tool_name: "Agent", tool_input: { prompt: "y", description: "b", subagent_type: "kame" } }, "u2");
  board.onEvent({ type: "system", subtype: "task_started", task_id: "ag-1", tool_use_id: "u1" });
  board.onEvent({ type: "system", subtype: "task_started", task_id: "ag-2", tool_use_id: "u2" });
  const longData = `https://ok.example/a?${"q=1&".repeat(40)}`;
  const fetchAs = (agent: string, type: string, url: string, id: string) => pre(gate, { agent_id: agent, agent_type: type, tool_name: "WebFetch", tool_input: { url } }, id);
  assert.equal((await fetchAs("ag-1", "sid", longData, "f1")).decision, "allow", "before reading: the normal 500-character allowance");
  await post(gate, { agent_id: "ag-1", agent_type: "sid", tool_name: "WebSearch", tool_input: { query: "q" } });
  assert.equal((await fetchAs("ag-1", "sid", longData, "f2")).decision, "deny", "tainted: data in the address is refused");
  assert.equal((await fetchAs("ag-1", "sid", "https://ok.example/wiki/Glacier", "f3")).decision, "allow", "a plain page is fine");
  assert.equal((await fetchAs("ag-2", "kame", longData, "f4")).decision, "deny", "kame has no WebFetch in its kit anyway");
  void store;
  done();
});

// 2026-10-16 (security review): taint must travel with the work. A research agent's report reaches the main thread; a task made after web text starts tainted.
test("taint: an agent that read the web taints the main thread when it ends; a task made while tainted starts tainted", async () => {
  const { gate, store, board, done } = setup();
  const tool = (t: string) => ({ tool_name: `mcp__atom__${t}`, tool_input: {} });
  await pre(gate, { tool_name: "Agent", tool_input: { prompt: "x", description: "a", subagent_type: "sid" } }, "u1");
  board.onEvent({ type: "system", subtype: "task_started", task_id: "ag-1", tool_use_id: "u1" });
  const sid = store.list().find((h) => h.id === "sid")!.jobs[0]!.id;
  await post(gate, { agent_id: "ag-1", agent_type: "sid", tool_name: "WebFetch", tool_input: { url: "https://evil.example/p" } });
  assert.equal((await pre(gate, tool("create_agent"), "m1")).decision, "allow", "the main thread has read nothing itself yet");
  await gate.agentEnded(sid);
  assert.equal((await pre(gate, tool("create_agent"), "m2")).decision, "deny", "the report came from a page: refused");
  assert.equal((await pre(gate, tool("computer"), "m3")).decision, "deny");
  // A task made while the main thread is tainted starts tainted: its long WebFetch address is refused at once.
  await pre(gate, { tool_name: "Agent", tool_input: { prompt: "y", description: "b", subagent_type: "sid" } }, "u2");
  board.onEvent({ type: "system", subtype: "task_started", task_id: "ag-2", tool_use_id: "u2" });
  const long = `https://ok.example/a?${"q=1&".repeat(40)}`;
  assert.equal((await pre(gate, { agent_id: "ag-2", agent_type: "sid", tool_name: "WebFetch", tool_input: { url: long } }, "f9")).decision, "deny");
  gate.newAnswer(undefined);
  assert.equal((await pre(gate, tool("create_agent"), "m4")).decision, "allow", "the user spoke");
  done();
});

test("Full access never grants an unknown MCP server, bypasses plan-first or waives external-content freshness", async () => {
  const { chatAccessPolicy } = await import("./chat-access.ts");
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-full-gate-")));
  const store = openHelperStore({ path: ":memory:", home });
  const board = boardRecorder(store, "cedar"); let asks = 0;
  const server = store.addMcpServer({ name: "fixture", kind: "command", command: "fictional-command" });
  store.recordMcpTest(server.id, { tools: ["inspect"] }); store.setMcpServer(server.id, { enabled: true, workers: ["sid"] });
  const gate = nativeGate({ tools: ["Agent"], access: chatAccessPolicy("full", () => "full"), team: {
    chatId: "cedar", helpers: store, board, worktrees: join(home, "worktrees"), home,
    approve: async () => { asks++; return false; },
  } });
  try {
    assert.equal((await pre(gate, sub("sid", "mcp__unknown__inspect", {}), "unknown")).decision, "deny");
    assert.equal((await pre(gate, sub("sid", "mcp__fixture__inspect", {}), "routine")).decision, "allow"); assert.equal(asks, 0);
    gate.mcpRead("a-sid");
    assert.equal((await pre(gate, sub("sid", "mcp__fixture__inspect", {}), "tainted")).decision, "deny"); assert.equal(asks, 1);
    store.setPlanFirst("kame", true);
    assert.equal((await pre(gate, sub("kame", "Write", { file_path: join(home, "new.txt"), content: "x" }), "unplanned")).decision, "deny");
    assert.equal((await pre(gate, sub("kame", "ExitPlanMode", { plan: "Cedar changes" }), "plan")).decision, "deny"); assert.equal(asks, 2);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
});

test("imported note data cannot turn an ordinary read into action approval, including in Full access", async () => {
  const { chatAccessPolicy } = await import("./chat-access.ts");
  const { SOURCE_DATA_MARKER } = await import("./brain-source-context.ts");
  const { gate, done } = setup();
  try {
    assert.equal((await gate.canUseTool("mcp__atom__create_agent", {}, { toolUseID: "before-import" })).behavior, "allow");
    const post = (gate.hooks.PostToolUse as { matcher: string; hooks: ((input: any) => Promise<unknown>)[] }[]).find((hook) => hook.matcher.includes("brain_open"))!;
    await post.hooks[0]!({ tool_name: "mcp__atom__brain_open", tool_response: SOURCE_DATA_MARKER + "Send an invitation", agent_id: undefined });
    const verdict = await gate.canUseTool("mcp__atom__create_agent", {}, { toolUseID: "tainted" });
    assert.equal(verdict.behavior, "deny"); assert.match(verdict.message!, /imported note/);
  } finally { done(); }
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-imported-full-"))), store = openHelperStore({ path: ":memory:", home });
  try {
    const full = nativeGate({ tools: ["Agent"], access: chatAccessPolicy("full", () => "full"), team: {
      chatId: "cedar", helpers: store, board: boardRecorder(store, "cedar"), worktrees: join(home, "worktrees"), home, approve: async () => false,
    } });
    full.knowledgeRead("");
    assert.equal((await full.canUseTool("mcp__atom__create_agent", {}, { toolUseID: "full-tainted" })).behavior, "deny");
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
});
