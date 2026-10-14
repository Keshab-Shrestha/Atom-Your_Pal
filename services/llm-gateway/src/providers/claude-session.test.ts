import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolRunner } from "@atom/contracts";
import { openChatSession, prefixHash, type ChatSessionOptions, type SessionSdk } from "./claude-session.ts";
import { ProviderError } from "../gateway.ts";

import { sdkVersion } from "./plan-support.ts";
// ---- fakes: one scripted Claude Code process per query; no `claude` process and no network

type Msg = Record<string, any>;

function channel<T>() {
  const items: T[] = [];
  let done = false;
  let wake: (() => void) | undefined;
  return {
    push(x: T) {
      items.push(x);
      wake?.();
    },
    end() {
      done = true;
      wake?.();
    },
    async *read() {
      for (;;) {
        while (items.length) yield items.shift()!;
        if (done) return;
        await new Promise<void>((r) => (wake = r));
        wake = undefined;
      }
    },
  };
}

export interface FakeQuery {
  options: Record<string, any>;
  sent: Msg[];
  interrupted: number;
  closed: boolean;
  model?: string;
  inject(m: Msg): void;
}

export const init = (apiKeySource = "none"): Msg => ({ type: "system", subtype: "init", apiKeySource, session_id: "sess-1" });
export const done = (result: string, extra: Msg = {}): Msg => ({ type: "result", subtype: "success", is_error: false, result, session_id: "sess-1", ...extra });
const usage = (input: number, cacheRead: number, cacheWrite: number) => ({ input_tokens: input, output_tokens: 3, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite });

/** `reply` scripts the answer to each user message. Returns `null` to answer nothing (until interrupted). */
export function fakeSdk(reply: (text: string, q: FakeQuery) => Msg[] | null = (t) => [done(`re: ${t}`)]) {
  const queries: FakeQuery[] = [];
  const sdk: SessionSdk = {
    tool: (name, description, shape, handler) => ({ name, description, shape, handler }) as never,
    createSdkMcpServer: (o) => ({ type: "sdk", ...o }) as never,
    query: ({ prompt, options }) => {
      const out = channel<Msg>();
      const q: FakeQuery = { options: options as Record<string, any>, sent: [], interrupted: 0, closed: false, inject: (m) => out.push(m) };
      queries.push(q);
      out.push(init());
      void (async () => {
        for await (const m of prompt) {
          q.sent.push(m as Msg);
          for (const r of reply(String((m as Msg).message.content), q) ?? []) out.push(r);
        }
        out.end();
      })();
      return Object.assign(out.read(), {
        interrupt: async () => {
          q.interrupted++;
          out.push({ type: "result", subtype: "error_during_execution", is_error: true, session_id: "sess-1" });
        },
        setModel: async (m?: string) => void (q.model = m),
        close: () => void (q.closed = true),
      });
    },
  };
  return { sdk, queries };
}

const runner: ToolRunner = {
  specs: () => [{ name: "weather", description: "Weather.", inputSchema: { type: "object", properties: { city: { type: "string" } } } }],
  run: async (call) => ({ callId: call.id, content: "sunny" }),
};
const gate = { canUseTool: async () => ({ behavior: "deny", message: "no" }), hooks: { PreToolUse: [] } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const options = (sdk: SessionSdk, over: Partial<ChatSessionOptions> = {}): ChatSessionOptions => ({
  chatId: "c1",
  claudePath: "/bin/claude",
  model: "claude-sonnet-5-5",
  systemPrompt: "You are ATOM.",
  tools: ["WebSearch", "WebFetch"],
  gate,
  atomTools: runner,
  env: { PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "sk-x", ANTHROPIC_BASE_URL: "http://x", OPENAI_API_KEY: "o" },
  sdk,
  ...over,
});

test("three turns go into one query: one process, one prefix, each answer in turn", async () => {
  const { sdk, queries } = fakeSdk();
  const s = await openChatSession(options(sdk));
  for (const text of ["one", "two", "three"]) assert.equal((await s.send(text)).text, `re: ${text}`);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]!.sent.map((m) => m.message.content), ["one", "two", "three"]);
  assert.equal(s.sessionId, "sess-1");
  s.close();
});

test("options: no ANTHROPIC_* or other keys, no settings, strict MCP, permissionMode default, nothing pre-allowed, the atom agent, tool search flags", async () => {
  const { sdk, queries } = fakeSdk();
  const s = await openChatSession(options(sdk, { resume: "old-sess", cwd: "/p" }));
  const o = queries[0]!.options;
  assert.ok(!Object.keys(o.env).some((k) => /^(ANTHROPIC_|OPENAI_)/.test(k)), "no API keys reach Claude Code");
  assert.equal(o.env.PATH, "/bin");
  for (const [k, v] of Object.entries({ ENABLE_TOOL_SEARCH: "force", ENABLE_PROMPT_CACHING_1H: "1", CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: "5m", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: "1", CLAUDE_CODE_DISABLE_CRON: "1" })) {
    assert.equal(o.env[k], v, k);
  }
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.strictMcpConfig, true);
  assert.equal(o.permissionMode, "default", "explicit: left out, Claude Code's auto classifier approves calls");
  assert.deepEqual(o.allowedTools, []);
  assert.equal(o.persistSession, true);
  assert.equal(o.resume, "old-sess");
  assert.equal(o.cwd, "/p");
  assert.equal(o.includePartialMessages, true);
  assert.equal(o.systemPrompt, "You are ATOM.");
  assert.equal(o.agent, "atom");
  assert.deepEqual(o.tools, ["WebSearch", "WebFetch", "ToolSearch"]);
  assert.deepEqual(o.agents.atom.tools, ["WebSearch", "WebFetch", "ToolSearch", "mcp__atom__weather"]);
  assert.equal(o.agents.atom.prompt, "You are ATOM.");
  assert.deepEqual(Object.keys(o.mcpServers), ["atom"]);
  assert.equal(o.mcpServers.atom.alwaysLoad, undefined, "ATOM tools stay deferred behind tool search");
  assert.equal(o.canUseTool, gate.canUseTool);
  assert.equal(o.hooks, gate.hooks);
  assert.equal(s.prefix, prefixHash("You are ATOM.", ["WebSearch", "WebFetch", "weather"]));
  s.close();
});

test("a session started with an API key stops at once, and the turn fails", async () => {
  const { sdk } = fakeSdk();
  const original = sdk.query;
  sdk.query = (args) => {
    const it = original(args);
    return Object.assign(
      (async function* () {
        for await (const m of it) yield m.type === "system" ? init("ANTHROPIC_API_KEY") : m;
      })(),
      { close: () => {} },
    );
  };
  const s = await openChatSession(options(sdk));
  await assert.rejects(s.send("hi"), (e: unknown) => e instanceof ProviderError && e.kind === "auth");
  await sleep(5);
  assert.equal(s.closed, true);
});

test("a message is client_composed only when asked", async () => {
  const { sdk, queries } = fakeSdk();
  const s = await openChatSession(options(sdk));
  await s.send("plain");
  await s.send("@.env", { clientComposed: true });
  assert.equal(queries[0]!.sent[0]!.client_composed, undefined);
  assert.equal(queries[0]!.sent[1]!.client_composed, true);
  s.close();
});

test("each turn is one usage row with this chat's id and this turn's cost", async () => {
  const { sdk } = fakeSdk((t) => [done(t, { usage: usage(2, t === "a" ? 0 : 2000, t === "a" ? 2300 : 50), total_cost_usd: t === "a" ? 0.004 : 0.005 })]);
  const rows: Array<[Record<string, unknown>, string, unknown]> = [];
  const s = await openChatSession(options(sdk, { onTokens: (tokens, model, meta) => rows.push([tokens as never, model, meta]) }));
  await s.send("a");
  await s.send("b");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0]![2], { chatId: "c1" });
  assert.equal(rows[0]![0].cacheWrite, 2300);
  assert.equal(rows[1]![0].cacheRead, 2000);
  assert.ok(Math.abs((rows[1]![0].costUsd as number) - 0.001) < 1e-9, "the turn's cost, not the session total");
  s.close();
});

test("an idle session closes; background tasks hold it open until they end", async () => {
  const { sdk, queries } = fakeSdk();
  const reasons: string[] = [];
  const s = await openChatSession(options(sdk, { idleMs: 20, onClose: (r) => reasons.push(r) }));
  await s.send("hi");
  queries[0]!.inject({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "t1", task_type: "agent", description: "x" }] });
  await sleep(60);
  assert.equal(s.closed, false, "held while a task runs");
  queries[0]!.inject({ type: "system", subtype: "background_tasks_changed", tasks: [] });
  await sleep(60);
  assert.equal(s.closed, true);
  assert.deepEqual(reasons, ["idle"]);
  assert.equal(queries[0]!.closed, true);
});

test("Stop interrupts the turn; the process stays for the next turn", async () => {
  const { sdk, queries } = fakeSdk((t) => (t === "slow" ? null : [done(`re: ${t}`)]));
  const s = await openChatSession(options(sdk));
  const stop = new AbortController();
  const turn = s.send("slow", { signal: stop.signal });
  await sleep(5);
  stop.abort();
  await assert.rejects(turn, (e: unknown) => e instanceof ProviderError && e.kind === "cancelled");
  assert.equal(queries[0]!.interrupted, 1);
  assert.equal(s.closed, false);
  assert.equal((await s.send("next")).text, "re: next");
  s.close();
});

test("text streams as it is written, without a Sources list; setModel switches the live process", async () => {
  const delta = (text: string) => ({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  const { sdk, queries } = fakeSdk(() => [delta("Hi "), delta("there.\nSources:\n- x"), done("Hi there.\nSources:\n- x")]);
  const s = await openChatSession(options(sdk));
  let heard = "";
  assert.equal((await s.send("q", { onText: (d) => (heard += d) })).text, "Hi there.");
  assert.equal(heard, "Hi there.");
  await s.setModel("claude-haiku-4-5");
  assert.equal(queries[0]!.model, "claude-haiku-4-5");
  assert.equal(s.model, "claude-haiku-4-5");
  s.close();
});

test("N2: sub-agents, sandbox and skills plugin go into the options; the main agent keeps its own entry and loads no skill", async () => {
  const { sdk, queries } = fakeSdk();
  const s = await openChatSession(
    options(sdk, { agents: { sid: { description: "Sid: researcher" }, atom: { description: "imposter" } }, sandbox: { enabled: true }, plugins: [{ type: "local", path: "/p" }] }),
  );
  const o = queries[0]!.options;
  assert.equal(o.agents.sid.description, "Sid: researcher");
  assert.equal(o.agents.atom.description, "ATOM, the user's assistant.", "an agent can never replace the main agent");
  assert.deepEqual(o.sandbox, { enabled: true });
  assert.deepEqual(o.plugins, [{ type: "local", path: "/p" }]);
  assert.deepEqual(o.skills, []);
  s.close();
});

test("N2: a reply Claude Code gives by itself (an agent reported) goes to onUnprompted; a turn sent meanwhile gets its own answer", async () => {
  const woken: string[] = [];
  const { sdk, queries } = fakeSdk((t) => (t === "two" ? [done("re: two")] : [done(`re: ${t}`)]));
  const s = await openChatSession(options(sdk, { onUnprompted: (text) => woken.push(text) }));
  assert.equal((await s.send("one")).text, "re: one");
  // Claude Code wakes itself: a background task finished.
  queries[0]!.inject({ type: "system", subtype: "background_tasks_changed", tasks: [{ id: "a1" }] });
  await sleep(5);
  assert.equal(s.background, 1);
  queries[0]!.inject({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "Sid is done." }] } });
  await sleep(5);
  const second = s.send("two"); // sent while the self-started turn still runs
  queries[0]!.inject(done("Sid found three flights."));
  assert.equal((await second).text, "re: two");
  assert.deepEqual(woken, ["Sid found three flights."]);
  s.close();
});

test("the installed Agent SDK's version is readable, for the session.open log", () => {
  assert.match(sdkVersion(), /^\d+\.\d+\.\d+/);
});
