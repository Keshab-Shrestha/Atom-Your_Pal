import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelRequest, ToolCall, ToolResult, ToolRunner, ToolSpec } from "@zeno/contracts";
import { createClaudePlanAdapter, scrubbedEnv, type ClaudeSdk, type PlanUsage } from "./claude-plan.ts";
import { createProviderAdapter } from "./index.ts";
import { ProviderError } from "../gateway.ts";

// ---- fakes: the SDK is replaced by a script of messages, so no `claude` process and no network is used

type Msg = Record<string, unknown>;
interface Seen { prompt: string; options: Record<string, any> }

const init = (apiKeySource = "none"): Msg => ({ type: "system", subtype: "init", apiKeySource, model: "claude-sonnet-5-5" });
const limit = (info: Record<string, unknown>): Msg => ({ type: "rate_limit_event", rate_limit_info: info });
const done = (result: string, extra: Msg = {}): Msg => ({ type: "result", subtype: "success", is_error: false, result, num_turns: 1, ...extra });

function fakeSdk(script: (seen: Seen, handlers: Record<string, (a: any) => Promise<any>>) => AsyncIterable<Msg>) {
  const seen: Seen[] = [];
  const handlers: Record<string, (a: any) => Promise<any>> = {};
  const sdk: ClaudeSdk = {
    tool: (name, description, shape, handler) => {
      handlers[name] = handler as never;
      return { name, description, shape, handler } as never;
    },
    createSdkMcpServer: (o) => ({ type: "sdk", ...o }) as never,
    query: ({ prompt, options }) => {
      const s = { prompt, options: options as Record<string, any> };
      seen.push(s);
      return script(s, handlers) as never;
    },
  };
  return { sdk, seen, handlers };
}

async function* msgs(...m: Msg[]) {
  for (const x of m) yield x;
}

const request = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  system: "You are ZENO.",
  messages: [{ role: "user", content: "hi there" }],
  context: { requestId: "r", sessionId: "s", source: "voice", receivedAt: new Date(0) },
  ...over,
});

const make = (sdk: ClaudeSdk, over: Record<string, unknown> = {}) =>
  createClaudePlanAdapter({ claudePath: "/bin/claude", model: "claude-sonnet-5-5", sdk, env: { PATH: "/bin", HOME: "/h" }, ...over });
const live = () => new AbortController().signal;

// ---- a plain answer

test("a plain question is answered from the plan, with no tools offered to Claude Code at all", async () => {
  const { sdk, seen } = fakeSdk(() => msgs(init(), limit({ status: "allowed", utilization: 0.3 }), done("Hello!")));
  const reply = await make(sdk).complete(request(), live());
  assert.deepEqual(reply, { text: "Hello!" });
  const o = seen[0]!.options;
  assert.equal(o.pathToClaudeCodeExecutable, "/bin/claude");
  assert.equal(o.model, "claude-sonnet-5-5");
  assert.equal(o.systemPrompt, "You are ZENO."); // replaces Claude Code's own prompt
  assert.deepEqual(o.tools, []); // none of Claude Code's built-in tools
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.strictMcpConfig, true); // keeps the account's claude.ai connectors out (40k tokens)
  assert.equal(o.persistSession, false);
  assert.equal(o.maxTurns, 1);
  assert.equal(o.mcpServers, undefined);
});

test("earlier turns are given to Claude as the conversation so far, and the newest message is the question", async () => {
  const { sdk, seen } = fakeSdk(() => msgs(init(), done("ok")));
  await make(sdk).complete(
    request({
      messages: [
        { role: "user", content: "my name is Keshab" },
        { role: "assistant", content: "Nice to meet you." },
        { role: "user", content: "what is my name?" },
      ],
    }),
    live(),
  );
  const p = seen[0]!.prompt;
  assert.match(p, /my name is Keshab/);
  assert.match(p, /Nice to meet you/);
  assert.ok(p.trimEnd().endsWith("what is my name?"));
  assert.ok(p.indexOf("my name is Keshab") < p.indexOf("what is my name?"));
});

test("a single message is sent as it is, with no transcript wrapper", async () => {
  const { sdk, seen } = fakeSdk(() => msgs(init(), done("ok")));
  await make(sdk).complete(request(), live());
  assert.equal(seen[0]!.prompt, "hi there");
});

// ---- the money rule: never silently bill per token

test("it removes every ANTHROPIC_ variable and cloud-provider switch, so no key can be used", () => {
  const env = scrubbedEnv({
    PATH: "/bin",
    HOME: "/h",
    ANTHROPIC_API_KEY: "sk-ant-xxxxxxxxxxxx",
    ANTHROPIC_AUTH_TOKEN: "t",
    ANTHROPIC_BASE_URL: "https://elsewhere",
    CLAUDE_CODE_OAUTH_TOKEN: "o",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1",
    GEMINI_API_KEY: "g",
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.HOME, "/h");
  assert.equal(Object.keys(env).filter((k) => /ANTHROPIC_|CLAUDE_CODE_(OAUTH|USE_)/.test(k)).length, 0);
  assert.equal(env.GEMINI_API_KEY, undefined); // other providers' keys are not handed to the child either
});

test("the env given to the SDK is the scrubbed one", async () => {
  const { sdk, seen } = fakeSdk(() => msgs(init(), done("ok")));
  await createClaudePlanAdapter({ claudePath: "/bin/claude", model: "m", sdk, env: { PATH: "/bin", ANTHROPIC_API_KEY: "sk-ant-yyyyyyyyyyyy" } }).complete(request(), live());
  assert.equal(seen[0]!.options.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(seen[0]!.options.env.PATH, "/bin");
});

test("if Claude Code reports it is using an API key, the request is stopped before it can be billed", async () => {
  let aborted = false;
  const { sdk } = fakeSdk(async function* (s) {
    s.options.abortController.signal.addEventListener("abort", () => (aborted = true));
    yield init("ANTHROPIC_API_KEY");
    yield done("this would have been billed per token");
  });
  await assert.rejects(make(sdk).complete(request(), live()), (e: any) => {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.kind, "auth");
    assert.match(e.message, /per token|API key/i);
    assert.doesNotMatch(e.message, /sk-ant/);
    return true;
  });
  assert.equal(aborted, true);
});

test("if the plan is spent and Claude would charge extra usage, it stops and says so", async () => {
  const { sdk } = fakeSdk(() => msgs(init(), limit({ status: "allowed", isUsingOverage: true }), done("charged")));
  await assert.rejects(make(sdk).complete(request(), live()), (e: any) => {
    assert.equal(e.kind, "rate_limit");
    assert.match(e.message, /extra usage/i);
    return true;
  });
});

test("a rejected plan limit says when it resets", async () => {
  const { sdk } = fakeSdk(() => msgs(init(), limit({ status: "rejected", resetsAt: 1791378000, rateLimitType: "five_hour" }), { type: "result", subtype: "error_during_execution", is_error: true }));
  await assert.rejects(make(sdk).complete(request(), live()), (e: any) => {
    assert.equal(e.kind, "rate_limit");
    assert.match(e.message, /plan limit/i);
    return true;
  });
});

test("plan usage is reported for the log, without anything secret", async () => {
  const { sdk } = fakeSdk(() =>
    msgs(init(), limit({ status: "allowed_warning", utilization: 0.66, rateLimitType: "seven_day", isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.3 }, seven_day: { utilization: 0.66 } } }), done("ok")),
  );
  const seen: PlanUsage[] = [];
  await make(sdk, { onUsage: (u: PlanUsage) => seen.push(u) }).complete(request(), live());
  assert.deepEqual(seen, [{ fiveHour: 0.3, sevenDay: 0.66, overage: false }]);
});

// ---- tools

const spec: ToolSpec = {
  name: "computer",
  description: "Use the Mac",
  inputSchema: {
    type: "object",
    properties: { action: { type: "string", description: "what" }, element: { type: "number" }, look_after: { type: "boolean" }, keys: { type: "array" } },
    required: ["action"],
  },
};

function runnerOf(fn: (call: ToolCall) => ToolResult | Promise<ToolResult>) {
  const calls: ToolCall[] = [];
  const runner: ToolRunner = { specs: () => [spec], run: async (call) => (calls.push(call), fn(call)) };
  return { runner, calls };
}

test("ZENO's tools are offered to Claude as one in-process server, and nothing else is allowed", async () => {
  const { runner } = runnerOf((c) => ({ callId: c.id, content: "ok" }));
  const { sdk, seen } = fakeSdk(() => msgs(init(), done("ok")));
  await make(sdk, { tools: runner }).complete(request({ tools: [spec] }), live());
  const o = seen[0]!.options;
  assert.deepEqual(o.allowedTools, ["mcp__zeno__computer"]);
  assert.equal(o.mcpServers.zeno.name, "zeno");
  assert.equal(o.mcpServers.zeno.tools.length, 1);
  assert.equal(o.mcpServers.zeno.tools[0].name, "computer");
  assert.deepEqual(o.tools, []);
  assert.ok(o.maxTurns > 1);
  assert.equal(o.permissionMode, "default");
});

test("without tools in the request (the out-of-steps wrap-up), Claude gets none and one turn", async () => {
  const { runner } = runnerOf((c) => ({ callId: c.id, content: "ok" }));
  const { sdk, seen } = fakeSdk(() => msgs(init(), done("I got stuck.")));
  await make(sdk, { tools: runner }).complete(request(), live());
  assert.equal(seen[0]!.options.mcpServers, undefined);
  assert.equal(seen[0]!.options.maxTurns, 1);
});

test("a tool call from Claude runs through ZENO's own tool engine, so its approvals and safety rules apply", async () => {
  const { runner, calls } = runnerOf((c) => ({ callId: c.id, content: `Clicked [${(c.input as any).element}].` }));
  const { sdk, handlers } = fakeSdk(async function* () {
    yield init();
    const out = await handlers.computer!({ action: "click", element: 2 });
    assert.deepEqual(out, { content: [{ type: "text", text: "Clicked [2]." }] });
    yield done("Done.");
  });
  const reply = await make(sdk, { tools: runner }).complete(request({ tools: [spec] }), live());
  assert.equal(reply.text, "Done.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, "computer");
  assert.deepEqual(calls[0]!.input, { action: "click", element: 2 });
  assert.ok(calls[0]!.id);
});

test("a tool that failed or was declined is passed to Claude as an error result", async () => {
  const { runner } = runnerOf((c) => ({ callId: c.id, content: "The user declined.", isError: true }));
  const { sdk, handlers } = fakeSdk(async function* () {
    yield init();
    const out = await handlers.computer!({ action: "click", element: 3 });
    assert.deepEqual(out, { content: [{ type: "text", text: "The user declined." }], isError: true });
    yield done("You declined, so I stopped.");
  });
  assert.equal((await make(sdk, { tools: runner }).complete(request({ tools: [spec] }), live())).text, "You declined, so I stopped.");
});

test("the tool's input schema reaches Claude with its types and descriptions", async () => {
  const { runner } = runnerOf((c) => ({ callId: c.id, content: "ok" }));
  const { sdk, seen } = fakeSdk(() => msgs(init(), done("ok")));
  await make(sdk, { tools: runner }).complete(request({ tools: [spec] }), live());
  const shape = seen[0]!.options.mcpServers.zeno.tools[0].shape;
  assert.deepEqual(Object.keys(shape).sort(), ["action", "element", "keys", "look_after"]);
  assert.equal(shape.action.safeParse("click").success, true);
  assert.equal(shape.action.safeParse(5).success, false);
  assert.equal(shape.action.description, "what");
  assert.equal(shape.element.safeParse(undefined).success, true); // optional
  assert.equal(shape.action.safeParse(undefined).success, false); // required
  assert.equal(shape.keys.safeParse(["cmd", "c"]).success, true);
  assert.equal(shape.look_after.safeParse(true).success, true);
});

// ---- errors

test("not being signed in is an auth error that says how to fix it", async () => {
  const { sdk } = fakeSdk(() => msgs(init(), { type: "assistant", error: "authentication_failed", message: { content: [] } }, { type: "result", subtype: "success", is_error: true, result: "Not logged in" }));
  await assert.rejects(make(sdk).complete(request(), live()), (e: any) => {
    assert.equal(e.kind, "auth");
    assert.match(e.message, /claude auth login|sign in|signed in/i);
    return true;
  });
});

test("with no claude binary found, the error says to install and sign in", async () => {
  const { sdk, seen } = fakeSdk(() => msgs(init(), done("x")));
  await assert.rejects(createClaudePlanAdapter({ claudePath: "", model: "m", sdk }).complete(request(), live()), (e: any) => {
    assert.equal(e.kind, "auth");
    assert.match(e.message, /claude auth login/);
    return true;
  });
  assert.equal(seen.length, 0);
});

test("an overloaded or failing service is a retryable outage when no tool has run", async () => {
  const { sdk } = fakeSdk(() => msgs(init(), { type: "assistant", error: "overloaded", message: { content: [] } }, { type: "result", subtype: "success", is_error: true, result: "Overloaded" }));
  await assert.rejects(make(sdk).complete(request(), live()), (e: any) => e.kind === "unavailable");
});

test("after a tool has acted, a failure is not retryable, because a retry would do the task twice", async () => {
  const { runner } = runnerOf((c) => ({ callId: c.id, content: "Clicked." }));
  const { sdk, handlers } = fakeSdk(async function* () {
    yield init();
    await handlers.computer!({ action: "click", element: 1 });
    yield { type: "assistant", error: "server_error", message: { content: [] } };
    yield { type: "result", subtype: "success", is_error: true, result: "boom" };
  });
  await assert.rejects(make(sdk, { tools: runner }).complete(request({ tools: [spec] }), live()), (e: any) => e.kind === "unknown");
});

test("running out of turns is reported plainly", async () => {
  const { sdk } = fakeSdk(() => msgs(init(), { type: "result", subtype: "error_max_turns", is_error: true, num_turns: 10 }));
  await assert.rejects(make(sdk).complete(request(), live()), (e: any) => e.kind === "bad_request" && /steps|turns/i.test(e.message));
});

test("an empty reply explains itself instead of returning nothing", async () => {
  const { sdk } = fakeSdk(() => msgs(init(), done("   ")));
  await assert.rejects(make(sdk).complete(request(), live()), (e: any) => e instanceof ProviderError && /no text/i.test(e.message));
});

test("an error from the SDK itself (the binary will not start) is an outage, and keeps no secret in its message", async () => {
  const { sdk } = fakeSdk(async function* () {
    throw new Error("spawn failed with ANTHROPIC_API_KEY=sk-ant-zzzzzzzzzzzz");
    yield init();
  });
  await assert.rejects(make(sdk).complete(request(), live()), (e: any) => {
    assert.equal(e.kind, "unavailable");
    assert.doesNotMatch(e.message, /sk-ant-zzz/);
    return true;
  });
});

test("cancelling stops Claude Code and the tool in flight", async () => {
  const controller = new AbortController();
  let sdkAbort: AbortSignal | undefined;
  let toolSignal: AbortSignal | undefined;
  const runner: ToolRunner = { specs: () => [spec], run: async (c, s) => ((toolSignal = s), { callId: c.id, content: "ok" }) };
  const { sdk, handlers } = fakeSdk(async function* (s) {
    sdkAbort = s.options.abortController.signal;
    yield init();
    await handlers.computer!({ action: "look" });
    controller.abort();
    await new Promise((r) => setTimeout(r, 5));
    yield done("late");
  });
  await assert.rejects(make(sdk, { tools: runner }).complete(request({ tools: [spec] }), controller.signal), (e: any) => e instanceof ProviderError && e.kind === "cancelled");
  assert.equal(sdkAbort!.aborted, true);
  assert.ok(toolSignal);
});

test("an already-cancelled request never starts Claude Code", async () => {
  const c = new AbortController();
  c.abort();
  const { sdk, seen } = fakeSdk(() => msgs(init(), done("x")));
  await assert.rejects(make(sdk).complete(request(), c.signal), (e: any) => e.kind === "cancelled");
  assert.equal(seen.length, 0);
});

// ---- wiring

test("the provider factory builds it, and the key slot carries the path of the signed-in claude", async () => {
  const adapter = createProviderAdapter({ provider: "claude-plan", apiKey: "/bin/claude", model: "claude-sonnet-5-5" });
  assert.equal(adapter.name, "claude-plan");
});

// ---- ADR-064: a pre-started process for the next request

function warmSdk(reply: (prompt: string, n: number) => AsyncIterable<Msg>) {
  const base = fakeSdk(() => msgs(init(), done("cold")));
  const started: Record<string, any>[] = [];
  const prompts: string[] = [];
  let closed = 0;
  base.sdk.startup = async ({ options }) => {
    started.push(options);
    return {
      query: (prompt: string) => {
        prompts.push(prompt);
        return reply(prompt, prompts.length) as never;
      },
      close: () => void closed++,
    };
  };
  return { ...base, started, prompts, closed: () => closed };
}

test("prepare pre-starts Claude Code; the next matching request uses it and the next one is started", async () => {
  const w = warmSdk(() => msgs(init(), done("warm")));
  const adapter = make(w.sdk);
  adapter.prepare!({ system: "You are ZENO." });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.started.length, 1);
  assert.equal(w.started[0]!.systemPrompt, "You are ZENO.");
  const reply = await adapter.complete(request({ systemExtra: "The time is 10:00." }), live());
  assert.deepEqual(reply, { text: "warm" });
  assert.equal(w.seen.length, 0, "no cold start");
  assert.match(w.prompts[0]!, /^Context for this request, from ZENO \(not said by the user\):\nThe time is 10:00\.\n\nhi there$/);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.started.length, 2, "the next request's process is already starting");
  adapter.close!();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.closed(), 1);
});

test("a request with different instructions does not use the prepared process; a broken one falls back to a cold start", async () => {
  const w = warmSdk(() => msgs(init(), done("warm")));
  const adapter = make(w.sdk);
  adapter.prepare!({ system: "Other." });
  assert.deepEqual(await adapter.complete(request(), live()), { text: "cold" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.closed(), 1, "the mismatched process is closed");

  const broken = warmSdk(() => {
    throw new Error("pipe closed");
  });
  const b = make(broken.sdk);
  b.prepare!({ system: "You are ZENO." });
  assert.deepEqual(await b.complete(request(), live()), { text: "cold" });
});

test("ZENO_PREWARM=0 never pre-starts", async () => {
  const w = warmSdk(() => msgs(init(), done("warm")));
  const adapter = make(w.sdk, { env: { PATH: "/bin", ZENO_PREWARM: "0" } });
  adapter.prepare!({ system: "You are ZENO." });
  await adapter.complete(request(), live());
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.started.length, 0);
});
