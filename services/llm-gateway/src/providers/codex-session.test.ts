import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelRequest, ToolRunner } from "@atom/contracts";
import { createCodexSessionAdapter, type CodexTurnDiagnostic } from "./codex-session.ts";
import { fakeCodex } from "../../../../tests/codex-harness.ts";

const request = (messages: ModelRequest["messages"]): ModelRequest => ({ system: "You are ATOM.", messages, context: { requestId: "r", sessionId: "chat", source: "text", receivedAt: new Date() } });
const runner: ToolRunner = { specs: () => [{ name: "atom_test", description: "Test", inputSchema: { type: "object" } }], run: async (c) => ({ callId: c.id, content: "Cedar" }) };

test("Codex keeps a live thread, sends later turns once, and rehydrates after an external transcript change", async () => {
  const fake = fakeCodex(({ turn }) => `answer ${turn}`);
  const adapter = createCodexSessionAdapter({ program: "fake", model: "codex-default", runner: () => runner, transport: fake.factory });
  const messages: ModelRequest["messages"] = [{ role: "user", content: "Cedar launches Wednesday." }];
  try {
    const first = await adapter.complete(request(messages), new AbortController().signal);
    messages.push({ role: "assistant", content: first.text }, { role: "user", content: "What day?" });
    await adapter.complete(request(messages), new AbortController().signal);
    assert.equal(fake.wires.length, 1);
    const turns = fake.wires[0]!.sent.filter((m) => m.method === "turn/start");
    assert.match(turns[0]!.params.input[0].text, /Cedar launches Wednesday/);
    assert.equal(turns[1]!.params.input[0].text, "User: What day?");
    await adapter.complete(request([...messages, { role: "assistant", content: "From another provider" }, { role: "user", content: "Continue" }]), new AbortController().signal);
    assert.equal(fake.wires.length, 2);
    assert.equal(fake.wires[0]!.closed, true);
    assert.match(fake.wires[1]!.sent.find((m) => m.method === "turn/start")!.params.input[0].text, /Cedar launches Wednesday/);
  } finally { adapter.close?.(); }
});

test("only registered host tools run; native execution approvals and unknown requests cannot grant access", async () => {
  let calls = 0;
  const fake = fakeCodex(async ({ call, start }) => {
    assert.equal(start.permissions, "atom_host_tools");
    assert.equal(start.config["features.shell_tool"], false);
    assert.equal(start.config["features.view_image"], false);
    const good = await call("atom_test", {});
    assert.equal(good.success, true);
    assert.equal((await call("not_registered", {})).success, false);
    assert.equal((await call("shell", {}, "item/commandExecution/requestApproval")).decision, "decline");
    assert.equal((await call("write", {}, "item/fileChange/requestApproval")).decision, "decline");
    assert.equal((await call("permissions", {}, "item/permissions/requestApproval")).code, -32601);
    return "done";
  });
  const adapter = createCodexSessionAdapter({ program: "fake", model: "codex-default", runner: () => ({ ...runner, run: async (c) => { calls++; return runner.run(c); } }), transport: fake.factory });
  try { await adapter.complete(request([{ role: "user", content: "go" }]), new AbortController().signal); assert.equal(calls, 1); }
  finally { adapter.close?.(); }
});

test("an unverified permission profile or inherited MCP server refuses the session before a model turn", async () => {
  for (const options of [{ profile: "wrong" }, { servers: ["external"] }]) {
    const fake = fakeCodex(() => "must not run", options);
    const adapter = createCodexSessionAdapter({ program: "fake", model: "codex-default", runner: () => runner, transport: fake.factory });
    try {
      await assert.rejects(adapter.complete(request([{ role: "user", content: "go" }]), new AbortController().signal), /cannot enforce|external MCP/);
      assert.ok(!fake.wires[0]!.sent.some((m) => m.method === "turn/start"));
    } finally { adapter.close?.(); }
  }
});

test("cancel closes the Codex process and concurrent requests cannot reset the active turn's host policy", async () => {
  let calls = 0;
  const fake = fakeCodex(() => new Promise(() => {}));
  const adapter = createCodexSessionAdapter({ program: "fake", model: "codex-default", runner: () => { calls++; return runner; }, transport: fake.factory });
  const ac = new AbortController();
  const first = adapter.complete(request([{ role: "user", content: "go" }]), ac.signal);
  await assert.rejects(adapter.complete(request([{ role: "user", content: "again" }]), new AbortController().signal), /still answering/);
  assert.equal(calls, 1);
  ac.abort();
  await assert.rejects(first, /stopped/);
  assert.equal(fake.wires[0]!.closed, true);
});

test("an account usage limit is reported explicitly and closes the failed session", async () => {
  const fake = fakeCodex(() => { throw new Error("You've hit your usage limit. Try again later."); });
  const adapter = createCodexSessionAdapter({ program: "fake", model: "codex-default", runner: () => runner, transport: fake.factory });
  try {
    await assert.rejects(adapter.complete(request([{ role: "user", content: "go" }]), new AbortController().signal), (error: any) => error.kind === "rate_limit" && /usage limit/.test(error.message));
    assert.equal(fake.wires[0]!.closed, true);
  } finally { adapter.close?.(); }
});

test("effective config disables inherited servers, plugins and local skills without connecting or changing global settings", async () => {
  const fake = fakeCodex(({ start }) => {
    assert.deepEqual(start.config.mcp_servers, { external: { enabled: false } });
    assert.deepEqual(start.config.plugins, { "private-plugin": { enabled: false } });
    assert.deepEqual(start.config.skills, { config: [{ path: "/fictional/local/SKILL.md", enabled: false }] });
    assert.equal(start.baseInstructions, "You are ATOM.");
    assert.equal(start.dynamicTools[0].name, "atom_test");
    return "done";
  }, { config: { mcp_servers: { external: { enabled: true } }, plugins: { "private-plugin": { enabled: true } } }, skills: { data: [{ skills: [{ path: "/fictional/local/SKILL.md" }], errors: [] }] } });
  const adapter = createCodexSessionAdapter({ program: "fake", model: "codex-default", runner: () => runner, transport: fake.factory });
  try {
    await adapter.complete(request([{ role: "user", content: "go" }]), new AbortController().signal);
    const sent = fake.wires[0]!.sent;
    const checks = sent.filter((m) => m.method === "mcpServerStatus/list");
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.params.threadId, "thread-0", "the mandatory final policy check is retained");
    assert.ok(!sent.some((m) => /(?:config\/write|skills\/config\/write)/.test(m.method ?? "")));
  } finally { adapter.close?.(); }
});

test("unreadable configuration or malformed skill discovery refuses before a model turn", async () => {
  for (const options of [{ config: null }, { config: { mcp_servers: [], plugins: {} } }, { skills: { data: [] } }, { skills: { data: [{ skills: [{ path: "relative" }], errors: [] }] } }, { skills: { data: [{ skills: [], errors: [{ message: "unreadable" }] }] } }]) {
    const fake = fakeCodex(() => "must not run", options);
    const adapter = createCodexSessionAdapter({ program: "fake", model: "codex-default", runner: () => runner, transport: fake.factory });
    try {
      await assert.rejects(adapter.complete(request([{ role: "user", content: "go" }]), new AbortController().signal), /could not be checked/);
      assert.ok(!fake.wires[0]!.sent.some((m) => m.method === "turn/start"));
      assert.equal(fake.wires[0]!.closed, true);
    } finally { adapter.close?.(); }
  }
});

test("diagnostics distinguish real zero-cache reuse, retain raw counters and record first text without logging content", async () => {
  const diagnostics: CodexTurnDiagnostic[] = [];
  const usage: unknown[] = [];
  const fake = fakeCodex(({ turn }) => {
    fake.wires[0]!.emit({ method: "item/agentMessage/delta", params: { threadId: "thread-0", delta: "reply" } });
    const last = { inputTokens: 1000, cachedInputTokens: turn === 1 ? 800 : 0, outputTokens: 10 };
    const total = { inputTokens: turn * 1000, cachedInputTokens: 800, outputTokens: turn * 10 };
    for (let i = 0; i < 2; i++) fake.wires[0]!.emit({ method: "thread/tokenUsage/updated", params: { threadId: "thread-0", tokenUsage: { total, last } } });
    return "reply";
  });
  const adapter = createCodexSessionAdapter({ program: "fake", model: "codex-default", runner: () => runner, transport: fake.factory, onUsage: (u) => usage.push(u), onDiagnostic: (d) => diagnostics.push(structuredClone(d)) });
  const messages: ModelRequest["messages"] = [{ role: "user", content: "PRIVATE-FICTIONAL-PROMPT" }];
  try {
    messages.push({ role: "assistant", content: (await adapter.complete(request(messages), new AbortController().signal)).text }, { role: "user", content: "continue" });
    await adapter.complete(request(messages), new AbortController().signal);
    assert.equal(fake.wires.length, 1);
    assert.equal(diagnostics[1]!.session, "reused");
    assert.equal(diagnostics[1]!.restart, "none");
    assert.deepEqual(diagnostics[1]!.setup, {});
    assert.equal(diagnostics[1]!.usage!.last.cachedInputTokens, 0);
    assert.deepEqual(usage, [{ input: 200, output: 10, cacheRead: 800, cacheWrite: 0 }, { input: 1000, output: 10, cacheRead: 0, cacheWrite: 0 }]);
    for (const d of diagnostics) assert.ok(d.completed && d.firstTextMs! >= d.readyMs && d.firstTextMs! <= d.totalMs);
    assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE-FICTIONAL-PROMPT|You are ATOM/);
  } finally { adapter.close?.(); }
});

test("a changed tool schema rehydrates all messages; a telemetry consumer cannot fail an answer", async () => {
  let description = "before";
  const fake = fakeCodex(() => "reply");
  const adapter = createCodexSessionAdapter({ program: "fake", model: "codex-default", runner: () => ({ ...runner, specs: () => [{ ...runner.specs()[0]!, description }] }), transport: fake.factory, onDiagnostic: () => { throw new Error("observer failed"); } });
  const messages: ModelRequest["messages"] = [{ role: "user", content: "Cedar launches Friday." }];
  try {
    const first = await adapter.complete(request(messages), new AbortController().signal);
    description = "after";
    messages.push({ role: "assistant", content: first.text }, { role: "user", content: "What day?" });
    assert.equal((await adapter.complete(request(messages), new AbortController().signal)).text, "reply");
    assert.equal(fake.wires.length, 2);
    assert.equal(fake.wires[0]!.closed, true);
    assert.match(fake.wires[1]!.sent.find((m) => m.method === "turn/start")!.params.input[0].text, /Cedar launches Friday/);
  } finally { adapter.close?.(); }
});
