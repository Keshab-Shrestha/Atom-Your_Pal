import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message, ProjectFiles, ToolRunner } from "@atom/contracts";
import { answerTail, MAX_PROJECT_FILE_CALLS, type ChatSession, type SessionSdk } from "@atom/llm-gateway";
import { openHelperStore } from "@atom/helpers";
import { openMemoryStore } from "@atom/memory";
import { CONTEXT_LABEL, createNativeCore, NATIVE_SYSTEM_PROMPT, NATIVE_TEAM_PROMPT, TYPED_NOTE, type NativeCoreDeps } from "./native-core.ts";
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
const sessions = () => {
  const map = new Map<string, ChatSession>();
  return { map, store: { get: (id: string) => map.get(id), set: (id: string, s: ChatSession) => void map.set(id, s) } };
};
const make = (sdk: SessionSdk, over: Partial<NativeCoreDeps> = {}) =>
  createNativeCore({ claudePath: "/bin/claude", tools: runner, modelFor: () => "claude-sonnet-5-5", sdk, web: true, env: { PATH: "/bin" }, newId: () => "chat-1", ...over });
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

test("shortcuts answer first; a chat's own model reopens the session with resume; with no model at all, the turn is refused", async () => {
  const { sdk, queries } = fakeSdk();
  let model: string | undefined = "claude-sonnet-5-5";
  const core = make(sdk, { modelFor: () => model, chatSessions: sessions().store, shortcuts: async (t) => (t === "pause" ? "Paused." : undefined) });
  assert.equal((await core.handle({ text: "pause", source: "voice" })).text, "Paused.");
  assert.equal(queries.length, 0);
  await core.handle({ text: "hi", source: "text" });
  model = "claude-haiku-4-5";
  await core.handle({ text: "hi", source: "text" });
  // A new process on the new model, resuming the same conversation: its system prompt names the right model.
  assert.equal(queries.length, 2);
  assert.equal(queries[1]!.options.model, "claude-haiku-4-5");
  assert.equal(queries[1]!.options.resume, "sess-1");
  model = undefined;
  await assert.rejects(core.handle({ text: "on gemini", source: "text" }), /could not find a model/);
  assert.equal(core.history().length, 6);
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
  assert.equal(await decision(plain, "WebFetch", { url: "https://example.com/x" }, "w1"), "allow");
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
  // The session's tool set is the ceiling for sub-agents, so it also holds their file tools (Kame, Puff); the main agent's own list stays small.
  assert.deepEqual([...o.tools].sort(), ["Agent", "Edit", "Glob", "Grep", "Read", "ToolSearch", "WebFetch", "WebSearch", "Write"].sort());
  assert.deepEqual(o.agents.atom.tools.filter((t: string) => !t.startsWith("mcp__")), ["WebSearch", "WebFetch", "Agent", "ToolSearch"], "the main thread cannot write");
  assert.equal(o.systemPrompt, NATIVE_TEAM_PROMPT);
  assert.ok(!NATIVE_TEAM_PROMPT.includes("delegate tool"));
  assert.equal(o.agents.sid.description, "Sid: researcher");
  assert.equal(o.agents["general-purpose"], undefined);
  assert.ok(o.disallowedTools.includes("Agent(general-purpose)"), "the built-in agents leave the listing");
  assert.equal(o.sandbox, undefined, "no sandbox (and no Bash) in a plain chat");
  assert.ok(o.hooks.SubagentStop && o.hooks.WorktreeCreate);
  assert.match(String(queries[0]!.sent[0]!.message.content), /delegate this request to Sid as it is, with the Agent tool \(subagent_type "sid"\)/);
  await core.handle({ text: "Well, what time is it", source: "voice" });
  assert.doesNotMatch(String(queries[0]!.sent[1]!.message.content), /delegate this request/);
  // ADR-126: "@Sid" anywhere in a typed message hands it over too; an @ that names no one does not.
  await core.handle({ text: "can you ask @sid to find cheap flights", source: "text" });
  assert.match(String(queries[0]!.sent[2]!.message.content), /delegate this request to Sid as it is/);
  await core.handle({ text: "mail me at k@example.com and ask @nobody", source: "text" });
  assert.doesNotMatch(String(queries[0]!.sent[3]!.message.content), /delegate this request/);
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

test("N3 fix: a report that comes during a turn of the same chat stays in the saved chat, before the request it preceded", async () => {
  // Claude Code starts a turn by itself after "one" (an agent reported); "two" comes while that turn runs.
  const queries: FakeQuery[] = [];
  const sdk: SessionSdk = {
    tool: (name) => ({ name }) as never,
    createSdkMcpServer: (o) => ({ type: "sdk", ...o }) as never,
    query: ({ prompt, options }) => {
      const q: FakeQuery = { options: options as Record<string, any>, sent: [] };
      queries.push(q);
      const result = (text: string) => ({ type: "result", subtype: "success", is_error: false, result: text, session_id: "sess-1" });
      async function* run() {
        yield { type: "system", subtype: "init", apiKeySource: "none", session_id: "sess-1" };
        for await (const m of prompt) {
          q.sent.push(m as Msg);
          const text = String((m as Msg).message.content).split("\n")[0]!;
          if (text === "one") {
            yield result("re one");
            yield { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Sid is done." }] } };
          } else {
            yield result("Sid found three flights.");
            yield result(`re ${text}`);
          }
        }
      }
      return Object.assign(run(), { close: () => {} });
    },
  };
  const store = openHelperStore({ path: ":memory:" });
  const saved: Array<readonly Message[]> = [];
  const wakes: Array<[string, boolean]> = [];
  const core = make(sdk, {
    onExchange: (_id, turns) => saved.push(turns),
    team: { helpers: store, approve: async () => false, worktrees: "/tmp/atom-n3-wake", onWake: (_chat, text, done) => wakes.push([text, done]) },
  });
  await core.handle({ text: "one", source: "text" });
  await sleep(5); // the self-started turn begins
  assert.equal((await core.handle({ text: "two", source: "text" })).text, "re two");
  assert.deepEqual(wakes, [["Sid found three flights.", true]], "the Core saved it: the owner does not save it again");
  assert.deepEqual(saved.at(-1), [
    { role: "user", content: "one" },
    { role: "assistant", content: "re one" },
    { role: "assistant", content: "Sid found three flights." },
    { role: "user", content: "two" },
    { role: "assistant", content: "re two" },
  ]);
  store.close();
});

// ---- shared context across providers

const other = (reply: (text: string) => string = (t) => `other: ${t}`) => {
  const requests: import("@atom/contracts").ModelRequest[] = [];
  return { requests, model: { complete: async (r: import("@atom/contracts").ModelRequest) => (requests.push(r), { text: reply(r.messages.at(-1)!.content) }) } };
};

test("the full chat survives more than twenty exchanges, persistence, reopening and a provider change", async () => {
  const memory = openMemoryStore({ path: ":memory:" });
  const o = other(() => "acknowledged");
  const { sdk, queries } = fakeSdk();
  const core = make(sdk, {
    modelFor: () => undefined,
    otherModel: () => o.model,
    onExchange: (id, turns) => memory.chats.save(id, turns),
  });
  try {
    for (let i = 0; i < 25; i++) await core.handle({ source: "text", text: i ? `Follow-up ${i}` : "Cedar launches on Wednesday." });
    assert.equal(core.history().length, 50);
    assert.equal(memory.chats.messages("chat-1").length, 50);
    assert.match(o.requests.at(-1)!.messages[0]!.content, /Cedar launches on Wednesday/);
    // A new Core is the process-restart path, using the actual persisted transcript.
    const reopened = make(sdk, { onExchange: (id, turns) => memory.chats.save(id, turns) });
    reopened.resume!("chat-1", memory.chats.messages("chat-1"));
    await reopened.handle({ source: "text", text: "What launch day did we agree on?" });
    assert.match(queries.at(-1)!.sent[0]!.message.content, /Cedar launches on Wednesday/);
    assert.equal(memory.chats.messages("chat-1").length, 52);
  } finally {
    memory.close();
  }
});

test("file grants are supplied as context and can be inspected or revoked without a model call", async () => {
  const memory = openMemoryStore({ path: ":memory:" });
  const helpers = openHelperStore({ path: ":memory:" });
  const { sdk, queries } = fakeSdk();
  const o = other();
  let revoked = "";
  const core = make(sdk, {
    modelFor: () => undefined, toolModel: () => o.model,
    team: { helpers, approve: async () => false, filePermissions: memory.filePermissions, worktrees: "/tmp/atom-permissions-wt" },
    revokeToolPermissions: (chat) => { revoked = chat; },
  });
  try {
    memory.filePermissions.forChat("chat-1").grant("/Users/test/Documents/cedar.txt");
    memory.filePermissions.forChat("another-chat").grant("/Users/test/Documents/cedar.txt");
    assert.match((await core.handle({ source: "text", text: "Show file permissions for this chat" })).text, /cedar.txt/);
    assert.equal(o.requests.length, 0);
    await core.handle({ source: "text", text: "Continue the same edit" });
    assert.match(o.requests[0]!.systemExtra!, /cedar.txt/);
    assert.match((await core.handle({ source: "text", text: "Forget file permissions for this chat" })).text, /Removed 1/);
    assert.equal(o.requests.length, 1);
    assert.equal(revoked, "chat-1");
    assert.deepEqual(memory.filePermissions.forChat("chat-1").list(), []);
    assert.equal(memory.filePermissions.forChat("another-chat").list().length, 1);
    await core.handle({ source: "text", text: "What access do you have now?" });
    assert.doesNotMatch(o.requests.at(-1)!.systemExtra ?? "", /explicitly allowed edits/);
    assert.match(o.requests.at(-1)!.systemExtra!, /no continuing file permissions/);
    assert.equal(queries.length, 0);
  } finally { helpers.close(); memory.close(); }
});

test("a chat that moves to another provider keeps its context, and moving back hands the Claude session the exchange it missed", async () => {
  const { sdk, queries } = fakeSdk((t) => `claude: ${t.split("\n")[0]}`);
  const o = other();
  let onClaude = true;
  const core = make(sdk, { modelFor: () => (onClaude ? "claude-sonnet-5-5" : undefined), otherModel: () => (onClaude ? undefined : o.model) });
  await core.handle({ text: "my name is Keshab", source: "text" });
  onClaude = false;
  const second = await core.handle({ text: "what is my name", source: "text" });
  assert.equal(second.text, "other: what is my name");
  const r = o.requests[0]!;
  assert.deepEqual(r.messages.map((m) => m.content), ["my name is Keshab", "claude: my name is Keshab", "what is my name"], "the other model sees the whole conversation");
  assert.match(r.system, /no tools, no agents and no file access/);
  assert.equal(r.tools, undefined);
  onClaude = true;
  await core.handle({ text: "and what did we say", source: "text" });
  const last = String(queries.at(-1)!.sent.at(-1)!.message.content);
  assert.match(last, /what is my name/, "the Claude session is told what the other model answered");
  assert.match(last, /other: what is my name/);
  assert.equal(core.history().length, 6);
});

test("a project chat refuses another provider with words; an empty reply is an error; an abort stays an abort", async () => {
  const { sdk } = fakeSdk();
  const files: ProjectFiles = { cwd: "/tmp/p", check: async () => undefined };
  const o = other();
  const core = make(sdk, { modelFor: () => undefined, otherModel: () => o.model, project: () => ({ note: "A project.", files }) });
  await assert.rejects(core.handle({ text: "hi", source: "text" }), /no project file tools/);
  assert.equal(o.requests.length, 0);
  const empty = make(sdk, { modelFor: () => undefined, otherModel: () => ({ complete: async () => ({ text: "  " }) }) });
  await assert.rejects(empty.handle({ text: "hi", source: "text" }), /gave no reply/);
  assert.equal(empty.history().length, 0, "a failed turn is not kept");
});

// ---- attached files

test("a chat with attached files gets Read, Glob and Grep confined to its folder, and no sandbox or Bash; web stays on", async () => {
  const { sdk, queries } = fakeSdk();
  const files: ProjectFiles = { cwd: "/tmp/atom-attached", check: async () => undefined, web: true };
  const store = openHelperStore({ path: ":memory:" });
  const core = make(sdk, {
    team: { helpers: store, approve: async () => false, worktrees: "/tmp/atom-attached-wt" },
    attachments: { turn: () => ({ note: "Files were attached.", files }), expand: (_c, t) => t },
  });
  await core.handle({ text: "read the file", source: "text" });
  const o = queries[0]!.options;
  assert.deepEqual([...o.tools].sort(), ["Agent", "Edit", "Glob", "Grep", "Read", "ToolSearch", "WebFetch", "WebSearch", "Write"].sort());
  assert.deepEqual(o.agents.atom.tools.filter((t: string) => !t.startsWith("mcp__")), ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Agent", "ToolSearch"], "no Write, Edit or Bash for the main thread");
  assert.equal(o.cwd, "/tmp/atom-attached");
  assert.match(String(o.systemPrompt), /Files were attached\./);
  assert.equal(o.sandbox, undefined, "attached files are not a project: no sandbox, no Bash");
  store.close();
});

test("another provider is given small attached text files inline, not their paths only", async () => {
  const { sdk } = fakeSdk();
  const o = other();
  const core = make(sdk, {
    modelFor: () => undefined,
    otherModel: () => o.model,
    attachments: { turn: () => undefined, expand: (_c, t) => t.replace("[Attached: a.txt — /x/a.txt]", "[Attached file a.txt: hello]") },
  });
  await core.handle({ text: "summarise [Attached: a.txt — /x/a.txt]", source: "text" });
  assert.equal(o.requests[0]!.messages.at(-1)!.content, "summarise [Attached file a.txt: hello]");
});

// ---- skills in chat

const skills = { use: (text: string) => (text.startsWith("/summarise") ? { text: text.replace("/summarise", "").trim() || "Use the summarise skill.", block: "SKILL STEPS: three lines." } : undefined) };

test("a message that starts with /skill goes to Claude as its words, with the skill's steps as context; the chat keeps what the user typed", async () => {
  const { sdk, queries } = fakeSdk();
  const core = make(sdk, { skills });
  await core.handle({ text: "/summarise this page", source: "text" });
  const sent = String(queries[0]!.sent[0]!.message.content);
  assert.match(sent, /^this page\n\n/);
  assert.match(sent, /SKILL STEPS: three lines\./);
  assert.equal(core.history()[0]!.content, "/summarise this page");
  await core.handle({ text: "thanks", source: "text" });
  assert.doesNotMatch(String(queries[0]!.sent[1]!.message.content), /SKILL STEPS/, "the steps are sent for the message that asked, not after");
});

test("a /skill message on another provider carries the steps in the request's extra context", async () => {
  const { sdk } = fakeSdk();
  const o = other();
  const core = make(sdk, { modelFor: () => undefined, otherModel: () => o.model, skills });
  await core.handle({ text: "/summarise this", source: "text" });
  assert.equal(o.requests[0]!.messages.at(-1)!.content, "this");
  assert.match(o.requests[0]!.systemExtra!, /SKILL STEPS/);
});

test("a typed message in the window gets the screen note; a spoken one and a client-composed core do not", async () => {
  const sentTo = async (over: Partial<NativeCoreDeps>, source: "text" | "voice") => {
    const { sdk, queries } = fakeSdk(() => "ok");
    await make(sdk, over).handle({ text: "hi", source });
    return queries[0]!.sent[0]!.message.content as string;
  };
  assert.equal(await sentTo({ screenReplies: true }, "text"), `hi\n\n${CONTEXT_LABEL}\n${TYPED_NOTE}`);
  assert.equal(await sentTo({ screenReplies: true }, "voice"), "hi");
  assert.equal(await sentTo({}, "text"), "hi");
});

// 2026-10-15: "research about X" matched "research that takes minutes" and sent a general-knowledge question to an agent
// (7 model calls, about 24k tokens, instead of 1 call, about 3k). The rule is now: answer a topic yourself, offer depth.
test("the prompt answers a topic itself and delegates only when named, when sources are asked for, when files change or when it needs many lookups", () => {
  for (const prompt of [NATIVE_SYSTEM_PROMPT, NATIVE_TEAM_PROMPT]) {
    assert.match(prompt, /Answer yourself, in a few sentences, any question or request to research or explain a topic you know well/);
    assert.match(prompt, /offer to have an? (worker|agent) look deeper with sources/);
    assert.match(prompt, /costs several times a direct reply/);
    assert.match(prompt, /only when the user names one or asks for sources, when files change, or when it needs many separate lookups/);
    assert.doesNotMatch(prompt, /research that takes minutes/, "the old trigger word is gone");
  }
  assert.match(NATIVE_TEAM_PROMPT, /with the Agent tool only when/);
  assert.ok(!NATIVE_TEAM_PROMPT.includes("delegate tool"), "the team prompt names the Agent tool");
});

// 2026-10-16 (code check): the phone and the window both write a chat. A live session was sent only the next question, so it never learned what the
// other side wrote. `resume` now gives it those messages with the next turn, found by content, so it also works when the saved chat is at its cap.
test("resume of the same chat gives the live session what another surface wrote since its last turn", async () => {
  const { sdk, queries } = fakeSdk((t) => `re ${t.split("\n")[0]}`);
  const core = make(sdk);
  await core.handle({ text: "one", source: "text" });
  await core.handle({ text: "two", source: "text" });
  // Another Core wrote two more messages into the saved chat.
  const saved: Message[] = [
    { role: "user", content: "one" }, { role: "assistant", content: "re one" },
    { role: "user", content: "two" }, { role: "assistant", content: "re two" },
    { role: "user", content: "from the phone" }, { role: "assistant", content: "phone answer" },
  ];
  core.resume!("chat-1", saved);
  await core.handle({ text: "three", source: "text" });
  assert.equal(queries.length, 1, "the same live session");
  const last = queries[0]!.sent.at(-1)!.message.content as string;
  assert.match(last, /Meanwhile, this chat went on elsewhere/);
  assert.match(last, /User: from the phone\nATOM: phone answer/);
  assert.match(last, /The user now says:\nthree/);
  // Nothing new: no repeat, and no note.
  core.resume!("chat-1", [...saved, { role: "user", content: "three" }, { role: "assistant", content: "re three" }]);
  await core.handle({ text: "four", source: "text" });
  assert.ok(!(queries[0]!.sent.at(-1)!.message.content as string).includes("Meanwhile"));
});

// 2026-10-16: the prompt tells the main agent when to offer a skill and when to improve one.
test("the main agent's prompts tell it to offer a skill after a good agent task and to improve a skill the user complains about", () => {
  assert.match(NATIVE_SYSTEM_PROMPT, /call improve_skill with the whole improved steps; the user decides/);
  assert.match(NATIVE_SYSTEM_PROMPT, /Never change a skill any other way/);
  assert.match(NATIVE_TEAM_PROMPT, /offer once, in a few words, to save it as a skill, and call propose_skill only if the user says yes/);
  assert.match(NATIVE_TEAM_PROMPT, /improve_skill/);
  assert.ok(!NATIVE_SYSTEM_PROMPT.includes("propose_skill"), "without a team there is no task to make a skill from");
});
