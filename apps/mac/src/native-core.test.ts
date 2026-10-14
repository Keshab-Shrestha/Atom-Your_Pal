import { test } from "node:test";
import assert from "node:assert/strict";
import type { Core } from "@atom/core";
import type { Message, ProjectFiles, ToolRunner } from "@atom/contracts";
import { answerTail, MAX_PROJECT_FILE_CALLS, type ChatSession, type SessionSdk } from "@atom/llm-gateway";
import { openHelperStore } from "@atom/helpers";
import { CONTEXT_LABEL, createNativeCore, NATIVE_SYSTEM_PROMPT, NATIVE_TEAM_PROMPT, type NativeCoreDeps } from "./native-core.ts";
import { nativeGate } from "./native-safety.ts";

// ---- a fake SDK: each query is one scripted Claude Code process that answers every pushed message

type Msg = Record<string, any>;
interface FakeQuery {
  options: Record<string, any>;
  sent: Msg[];
  model?: string;
}

function fakeSdk(answer: (text: string) => string = () => "ok") {
  const queries: FakeQuery[] = [];
  const sdk: SessionSdk = {
    tool: (name) => ({ name }) as never,
    createSdkMcpServer: (o) => ({ type: "sdk", ...o }) as never,
    query: ({ prompt, options }) => {
      const q: FakeQuery = { options: options as Record<string, any>, sent: [] };
      queries.push(q);
      const id = `sess-${queries.length}`;
      async function* run() {
        yield { type: "system", subtype: "init", apiKeySource: "none", session_id: id };
        for await (const m of prompt) {
          q.sent.push(m as Msg);
          const text = String((m as Msg).message.content);
          yield { type: "result", subtype: "success", is_error: false, result: answer(text), session_id: id, usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } };
        }
      }
      return Object.assign(run(), { setModel: async (m?: string) => void (q.model = m), close: () => {} });
    },
  };
  return { sdk, queries };
}

const runner: ToolRunner = { specs: () => [{ name: "delegate", description: "Hand work.", inputSchema: { type: "object" } }], run: async (c) => ({ callId: c.id, content: "ok" }) };
const legacyCore = (calls: string[] = []): Core => {
  let id = "x";
  let turns: Message[] = [];
  return {
    get sessionId() {
      return id;
    },
    handle: async (input) => {
      calls.push(input.text);
      turns = [...turns, { role: "user", content: input.text }, { role: "assistant", content: "legacy" }];
      return { requestId: "r", text: "legacy" };
    },
    history: () => turns,
    reset: () => {},
    resume: (sid, t) => void ((id = sid), (turns = [...t])),
    prepare: () => {},
  };
};
const sessions = () => {
  const map = new Map<string, ChatSession>();
  return { map, store: { get: (id: string) => map.get(id), set: (id: string, s: ChatSession) => void map.set(id, s) } };
};
const make = (sdk: SessionSdk, over: Partial<NativeCoreDeps> = {}) =>
  createNativeCore({ claudePath: "/bin/claude", tools: runner, modelFor: () => "claude-sonnet-5-5", legacy: legacyCore(), sdk, web: true, env: { PATH: "/bin" }, newId: () => "chat-1", ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a plain chat: three turns in one session; the context goes last and labelled; the opening context only once", async () => {
  const { sdk, queries } = fakeSdk((t) => `re ${t.split("\n")[0]}`);
  const saved: Array<readonly Message[]> = [];
  const core = make(sdk, { context: () => "Now: Monday.", opening: () => "Your team: Sid.", onExchange: (_id, turns) => saved.push(turns) });
  for (const text of ["one", "two", "three"]) assert.equal((await core.handle({ text, source: "voice" })).text, `re ${text}`);
  assert.equal(queries.length, 1);
  const sent = queries[0]!.sent.map((m) => m.message.content as string);
  assert.equal(sent[0], `one\n\n${CONTEXT_LABEL}\nYour team: Sid.\n\nNow: Monday.`);
  assert.equal(sent[1], `two\n\n${CONTEXT_LABEL}\nNow: Monday.`);
  const o = queries[0]!.options;
  assert.equal(o.systemPrompt, NATIVE_SYSTEM_PROMPT, "the system prompt has no dynamic context");
  assert.deepEqual(o.tools, ["WebSearch", "WebFetch", "ToolSearch"]);
  assert.equal(o.cwd, undefined);
  assert.equal(saved.at(-1)!.length, 6);
});

test("an idle session closes; the next turn reopens it with resume and only the new message", async () => {
  const { sdk, queries } = fakeSdk();
  const { map, store } = sessions();
  const core = make(sdk, { idleMs: 10, chatSessions: store });
  await core.handle({ text: "hi", source: "text" });
  assert.deepEqual(map.get("chat-1"), { id: "sess-1", model: "claude-sonnet-5-5", tail: answerTail("ok") });
  await sleep(40);
  await core.handle({ text: "again", source: "text" });
  assert.equal(queries.length, 2);
  assert.equal(queries[1]!.options.resume, "sess-1");
  assert.equal(queries[1]!.sent[0]!.message.content, "again");
});

test("a chat with history but no session to resume starts with the transcript", async () => {
  const { sdk, queries } = fakeSdk();
  const core = make(sdk);
  core.resume("old", [{ role: "user", content: "earlier" }, { role: "assistant", content: "answer" }]);
  await core.handle({ text: "now", source: "text" });
  assert.equal(queries[0]!.options.resume, undefined);
  assert.match(queries[0]!.sent[0]!.message.content, /Conversation so far:\nUser: earlier\nATOM: answer\n\nThe user now says:\nnow/);
});

test("`@.env`, `/cmd` and Telegram/API text go client_composed; plain speech does not", async () => {
  const { sdk, queries } = fakeSdk();
  const core = make(sdk);
  for (const text of ["hello", "read @.env", "/cmd do it"]) await core.handle({ text, source: "text" });
  assert.deepEqual(queries[0]!.sent.map((m) => m.client_composed), [undefined, true, true]);
  const other = fakeSdk();
  await make(other.sdk, { clientComposed: true }).handle({ text: "hello", source: "text" });
  assert.equal(other.queries[0]!.sent[0]!.client_composed, true);
});

const projectFiles = (over: Partial<ProjectFiles> = {}) => {
  const checked: string[] = [];
  const files: ProjectFiles = {
    cwd: "/Users/k/app",
    check: async (name, input) => (checked.push(name), String(input.file_path ?? "").includes("secret") ? "Secret files are never read." : undefined),
    ...over,
  };
  return { files, checked };
};

test("a project chat: its note in the prompt, Read/Glob/Grep in the folder, web only when its switch is on; a changed prefix reopens with resume", async () => {
  const { sdk, queries } = fakeSdk();
  let project = { note: "This chat belongs to the project \"App\".", files: projectFiles().files };
  const { store } = sessions();
  const core = make(sdk, { project: () => project, chatSessions: store });
  await core.handle({ text: "what is in it?", source: "text" });
  const o = queries[0]!.options;
  assert.equal(o.systemPrompt, `${NATIVE_SYSTEM_PROMPT}\n\nThis chat belongs to the project "App".`);
  assert.deepEqual(o.tools, ["Read", "Glob", "Grep", "ToolSearch"]);
  assert.equal(o.cwd, "/Users/k/app");
  project = { ...project, files: projectFiles({ web: true }).files };
  await core.handle({ text: "and online?", source: "text" });
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1]!.options.tools, ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "ToolSearch"]);
  assert.equal(queries[1]!.options.resume, "sess-1");
});

test("shortcuts answer first; a chat's own model switches the live session; not on the plan, the legacy Core answers", async () => {
  const { sdk, queries } = fakeSdk();
  let model: string | undefined = "claude-sonnet-5-5";
  const calls: string[] = [];
  const core = make(sdk, { modelFor: () => model, legacy: legacyCore(calls), shortcuts: async (t) => (t === "pause" ? "Paused." : undefined) });
  assert.equal((await core.handle({ text: "pause", source: "voice" })).text, "Paused.");
  assert.equal(queries.length, 0);
  await core.handle({ text: "hi", source: "text" });
  model = "claude-haiku-4-5";
  await core.handle({ text: "hi", source: "text" });
  assert.equal(queries.length, 1);
  assert.equal(queries[0]!.model, "claude-haiku-4-5");
  model = undefined;
  assert.equal((await core.handle({ text: "on gemini", source: "text" })).text, "legacy");
  assert.deepEqual(calls, ["on gemini"]);
  assert.equal(core.history().length, 8);
});

test("each answer is one usage row with the chat id", async () => {
  const { sdk } = fakeSdk();
  const rows: unknown[] = [];
  const core = make(sdk, { onTokens: (_t, model, meta) => rows.push([model, meta]) });
  await core.handle({ text: "a", source: "voice" });
  await core.handle({ text: "b", source: "voice" });
  assert.deepEqual(rows, [["claude-sonnet-5-5", { chatId: "chat-1" }], ["claude-sonnet-5-5", { chatId: "chat-1" }]]);
});

// ---- the gate: every ADR-107 refusal of the legacy adapter, through the hook and through canUseTool

const hookOf = (gate: ReturnType<typeof nativeGate>) => (gate.hooks as any).PreToolUse[0].hooks[0];
const decision = async (gate: ReturnType<typeof nativeGate>, tool_name: string, tool_input: Record<string, unknown>, id: string) =>
  (await hookOf(gate)({ tool_name, tool_input }, id)).hookSpecificOutput.permissionDecision;

test("the main thread never gets Bash, Write, Edit or a tool outside its set; ATOM's tools and ToolSearch pass", async () => {
  const gate = nativeGate({ tools: ["Read", "Glob", "Grep"], files: projectFiles().files });
  for (const tool of ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent", "mcp__other__x"]) {
    assert.equal((await gate.canUseTool(tool, { command: "ls" }, { toolUseID: `c-${tool}` })).behavior, "deny", tool);
    assert.equal(await decision(gate, tool, { command: "ls" }, `h-${tool}`), "deny", tool);
  }
  for (const tool of ["mcp__atom__delegate", "ToolSearch"]) assert.equal((await gate.canUseTool(tool, {}, { toolUseID: tool })).behavior, "allow", tool);
  const plain = nativeGate({ tools: ["WebSearch", "WebFetch"] });
  assert.equal(await decision(plain, "Read", { file_path: "/etc/hosts" }, "r1"), "deny", "a plain chat reads no files");
  assert.equal(await decision(plain, "WebFetch", { url: "https://x" }, "w1"), "allow");
});

test("every project read goes through the check by hook and by callback; a refusal is a deny; prepare changes the input", async () => {
  const { files, checked } = projectFiles({ prepare: (n, i) => (n === "Grep" ? { ...i, glob: "!x" } : i) });
  const gate = nativeGate({ tools: ["Read", "Glob", "Grep"], files });
  assert.deepEqual(await gate.canUseTool("Read", { file_path: "/Users/k/app/a.ts" }, { toolUseID: "t1" }), { behavior: "allow", updatedInput: { file_path: "/Users/k/app/a.ts" } });
  assert.deepEqual(await gate.canUseTool("Grep", { pattern: "x" }, { toolUseID: "t2" }), { behavior: "allow", updatedInput: { pattern: "x", glob: "!x" } });
  assert.deepEqual(await gate.canUseTool("Read", { file_path: "/Users/k/app/secret.txt" }, { toolUseID: "t3" }), { behavior: "deny", message: "Secret files are never read." });
  assert.equal(await decision(gate, "Read", { file_path: "/Users/k/app/secret.txt" }, "t4"), "deny");
  assert.deepEqual(checked, ["Read", "Grep", "Read", "Read"]);
});

test("one call is checked once by hook and callback; the ninth read of an answer is refused; a new answer starts the count again", async () => {
  const { files, checked } = projectFiles();
  const gate = nativeGate({ tools: ["Read", "Glob", "Grep"], files });
  for (let i = 1; i <= MAX_PROJECT_FILE_CALLS; i++) {
    const input = { file_path: `/Users/k/app/f${i}.ts` };
    assert.equal(await decision(gate, "Read", input, `c${i}`), "allow");
    assert.equal((await gate.canUseTool("Read", input, { toolUseID: `c${i}` })).behavior, "allow");
  }
  assert.equal(checked.length, MAX_PROJECT_FILE_CALLS);
  const ninth = await gate.canUseTool("Read", { file_path: "/Users/k/app/f9.ts" }, { toolUseID: "c9" });
  assert.equal(ninth.behavior, "deny");
  assert.match(String(ninth.message), /Answer now/);
  gate.newAnswer(files);
  assert.equal(await decision(gate, "Read", { file_path: "/Users/k/app/f9.ts" }, "c10"), "allow");
  gate.newAnswer(undefined);
  assert.equal(await decision(gate, "Read", { file_path: "/Users/k/app/f1.ts" }, "c11"), "deny", "the folder is gone: no reads");
});

// ---- Phase N2: sub-agents

/** A fake whose turn text sets the background task list: "spawn" adds one, "clear" empties it. */
function backgroundSdk() {
  const queries: FakeQuery[] = [];
  const sdk: SessionSdk = {
    tool: (name) => ({ name }) as never,
    createSdkMcpServer: (o) => ({ type: "sdk", ...o }) as never,
    query: ({ prompt, options }) => {
      const q: FakeQuery = { options: options as Record<string, any>, sent: [] };
      queries.push(q);
      async function* run() {
        yield { type: "system", subtype: "init", apiKeySource: "none", session_id: "sess-1" };
        for await (const m of prompt) {
          q.sent.push(m as Msg);
          const text = String((m as Msg).message.content);
          if (text.startsWith("spawn")) yield { type: "system", subtype: "background_tasks_changed", tasks: [{ id: "a1" }] };
          if (text.startsWith("clear")) yield { type: "system", subtype: "background_tasks_changed", tasks: [] };
          yield { type: "result", subtype: "success", is_error: false, result: `re ${text.split("\n")[0]}`, session_id: "sess-1" };
        }
      }
      return Object.assign(run(), { close: () => {} });
    },
  };
  return { sdk, queries };
}

test("N2: with a team the main thread gets the Agent tool, the team prompt and the sub-agents; 'Sid, …' adds the fixed hand-over line", async () => {
  const { sdk, queries } = fakeSdk();
  const store = openHelperStore({ path: ":memory:" });
  const core = make(sdk, { team: { helpers: store, approve: async () => false, worktrees: "/tmp/atom-n2-worktrees" } });
  await core.handle({ text: "Sid, find cheap flights", source: "voice" });
  const o = queries[0]!.options;
  assert.deepEqual(o.tools, ["WebSearch", "WebFetch", "Agent", "ToolSearch"]);
  assert.equal(o.systemPrompt, NATIVE_TEAM_PROMPT);
  assert.ok(!NATIVE_TEAM_PROMPT.includes("delegate tool"));
  assert.equal(o.agents.sid.description, "Sid: researcher");
  assert.equal(o.agents["general-purpose"], undefined);
  assert.equal(o.sandbox, undefined, "no sandbox (and no Bash) in a plain chat");
  assert.ok(o.hooks.SubagentStop && o.hooks.WorktreeCreate);
  assert.match(String(queries[0]!.sent[0]!.message.content), /delegate this request to Sid as it is, with the Agent tool \(subagent_type "sid"\)/);
  await core.handle({ text: "Well, what time is it", source: "voice" });
  assert.doesNotMatch(String(queries[0]!.sent[1]!.message.content), /delegate this request/);
  store.close();
});

test("N2: a new agent restarts the session with resume only at a turn when no background task runs", async () => {
  const { sdk, queries } = backgroundSdk();
  const { store: chatSessions } = sessions();
  const core = make(sdk, { chatSessions });
  await core.handle({ text: "spawn an agent", source: "voice" });
  core.restartWhenIdle();
  await core.handle({ text: "clear when done", source: "voice" });
  assert.equal(queries.length, 1, "a background task held the old process");
  await core.handle({ text: "next", source: "voice" });
  assert.equal(queries.length, 2, "restarted once the background set was empty");
  assert.equal(queries[1]!.options.resume, "sess-1");
  await core.handle({ text: "again", source: "voice" });
  assert.equal(queries.length, 2, "one restart only");
});
