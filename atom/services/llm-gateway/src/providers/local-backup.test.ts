import { test } from "node:test";
import assert from "node:assert/strict";
import { localFixture } from "../../../../tests/local-backup-harness.ts";
import type { ModelRequest } from "@atom/contracts";
import { createGateway } from "../gateway.ts";
import { checkLocalBackup, createLocalBackupAdapter, type LocalBackupUsage } from "./local-backup.ts";

const answer = () => ({ model: "cedar/fixture:tiny", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Cedar Wednesday 🌲" } }], usage: { prompt_tokens: 20, completion_tokens: 4 } });
const request = (): ModelRequest => ({ access: "chat-only", system: "Text fixture only.", messages: [{ role: "user", content: "Cedar?" }],
  context: { requestId: "fixture", sessionId: "fixture", source: "text", receivedAt: new Date() } });

test("local endpoint validation refuses remote, credential, DNS, path, port and normalization bypasses", () => {
  for (const endpoint of ["https://127.0.0.1:1234/v1", "http://localhost:1234/v1", "http://127.0.0.2:1234/v1", "http://2130706433:1234/v1",
    "http://127.1:1234/v1", "http://[::ffff:127.0.0.1]:1234/v1", "http://127.0.0.1:1234/v1?token=fictional", "http://user@127.0.0.1:1234/v1",
    "http://127.0.0.1:1234/x/../v1", "http://127.0.0.1:1234/v1#x", "http://127.0.0.1:0/v1", "http://127.0.0.1:65536/v1"])
    assert.throws(() => checkLocalBackup({ endpoint, model: "cedar" }));
  for (const endpoint of ["http://127.0.0.1:80/v1", "http://[::1]:80/v1", "http://127.0.0.1:00123/v1/"])
    assert.deepEqual(checkLocalBackup(checkLocalBackup({ endpoint, model: "cedar:tiny" })), checkLocalBackup({ endpoint, model: "cedar:tiny" }));
  for (const model of ["", "x y", "x\n", "x".repeat(201)]) assert.throws(() => checkLocalBackup({ endpoint: "http://127.0.0.1:1234/v1", model }));
});

test("local probe is content-free; explicit completion sends exact text-only model request without proxy/credentials", async () => {
  const received: any[] = []; let usage: LocalBackupUsage | undefined;
  const fixture = await localFixture((req, res, body) => {
    received.push({ url: req.url, method: req.method, auth: req.headers.authorization, body });
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(req.url === "/v1/models" ? { data: [{ id: "cedar/fixture:tiny" }] } : answer()));
  });
  const old = process.env.HTTP_PROXY; process.env.HTTP_PROXY = "http://192.0.2.1:1";
  try {
    const adapter = createLocalBackupAdapter(fixture.config, (value) => { usage = value; });
    assert.deepEqual((await adapter.probe(new AbortController().signal)).models, [fixture.config.model]);
    assert.deepEqual(received[0], { url: "/v1/models", method: "GET", auth: undefined, body: undefined });
    const gateway = createGateway({ provider: adapter, maxRetries: 0, timeoutMs: 1000 });
    assert.match((await gateway.complete(request())).text, /Wednesday/);
    assert.equal(received[1].auth, undefined); assert.deepEqual(Object.keys(received[1].body).sort(), ["max_tokens", "messages", "model", "stream"]);
    assert.deepEqual(received[1].body.messages, [{ role: "system", content: "Text fixture only." }, { role: "user", content: "Cedar?" }]);
    assert.equal(usage!.input, 20); assert.equal(usage!.output, 4); assert.equal(usage!.truncated, false);
  } finally { if (old === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = old; await fixture.close(); }
});

for (const mode of ["redirect", "compressed", "invalid-json", "oversized", "other-model", "tools", "malformed-tools", "function", "empty", "multiple", "bad-finish", "unavailable"]) {
  test(`local backup rejects ${mode} without retry`, async () => {
    let calls = 0;
    const fixture = await localFixture((_req, res) => {
      calls++; const data: any = answer();
      if (mode === "redirect") { res.writeHead(302, { Location: "https://example.invalid/never-follow" }); res.end(); return; }
      if (mode === "compressed") res.setHeader("Content-Encoding", "gzip");
      if (mode === "invalid-json") { res.end("not JSON: fictional private server detail"); return; }
      if (mode === "oversized") { res.end("x".repeat(1_048_577)); return; }
      if (mode === "other-model") data.model = "other";
      if (mode === "tools") data.choices[0].message.tool_calls = [{ id: "x", function: { name: "send" } }];
      if (mode === "malformed-tools") data.choices[0].message.tool_calls = { name: "send" };
      if (mode === "function") data.choices[0].message.function_call = { name: "send" };
      if (mode === "empty") data.choices[0].message.content = "";
      if (mode === "multiple") data.choices.push(data.choices[0]);
      if (mode === "bad-finish") data.choices[0].finish_reason = "tool_calls";
      if (mode === "unavailable") res.statusCode = 503;
      res.end(JSON.stringify(data));
    });
    try {
      const gateway = createGateway({ provider: createLocalBackupAdapter(fixture.config), timeoutMs: 1000, maxRetries: 0 });
      await assert.rejects(gateway.complete(request()), (error: Error) => !error.message.includes("fictional private server detail"));
      assert.equal(calls, 1);
    } finally { await fixture.close(); }
  });
}

test("unsupported host capabilities and oversized context never reach local HTTP", async () => {
  let calls = 0; const fixture = await localFixture((_req, res) => { calls++; res.end(JSON.stringify(answer())); });
  try {
    const adapter = createLocalBackupAdapter(fixture.config);
    for (const changes of [{ access: "full" }, { web: true }, { project: true }, { reasoning: "high" }, { tools: [{ name: "send" }] },
      { files: { cwd: "/fictional" } }, { historyTools: {} }, { interactionTools: {} }, { messages: [{ role: "user", content: "水".repeat(20_000) }] }])
      await assert.rejects(adapter.complete({ ...request(), ...changes } as ModelRequest, new AbortController().signal));
    assert.equal(calls, 0);
  } finally { await fixture.close(); }
});

test("local timeout aborts a stalled owned connection without retry and length/unknown usage are explicit", async () => {
  let mode = "stall", calls = 0;
  const fixture = await localFixture((_req, res) => {
    calls++; if (mode === "stall") return;
    const data: any = answer(); data.choices[0].finish_reason = "length"; data.usage = { prompt_tokens: -1, completion_tokens: "untrusted" };
    res.end(JSON.stringify(data));
  });
  try {
    const gateway = createGateway({ provider: createLocalBackupAdapter(fixture.config), timeoutMs: 250, maxRetries: 0 });
    await assert.rejects(gateway.complete(request()), /within 250 ms/); assert.equal(calls, 1);
    mode = "length"; let usage: LocalBackupUsage | undefined;
    await createLocalBackupAdapter(fixture.config, (value) => { usage = value; }).complete(request(), new AbortController().signal);
    assert.equal(usage!.truncated, true); assert.equal(usage!.input, undefined); assert.equal(usage!.output, undefined);
  } finally { await fixture.close(); }
});
