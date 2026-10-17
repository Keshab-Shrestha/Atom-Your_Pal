import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelRequest, ToolRunner } from "@atom/contracts";
import { createCodexSessionAdapter } from "./codex-session.ts";
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
