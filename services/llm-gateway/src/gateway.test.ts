import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelRequest, ModelResponse } from "@zeno/contracts";
import { GatewayError, ProviderError, createGateway, redactSecrets, type ProviderAdapter } from "./gateway.ts";

const request: ModelRequest = {
  system: "be brief",
  messages: [{ role: "user", content: "hi" }],
  context: { requestId: "r1", sessionId: "s1", source: "voice", receivedAt: new Date(0) },
};

function adapter(behaviour: (call: number, signal: AbortSignal) => Promise<ModelResponse>) {
  const calls: ModelRequest[] = [];
  const provider: ProviderAdapter = {
    name: "fake",
    complete(req, signal) {
      calls.push(req);
      return behaviour(calls.length, signal);
    },
  };
  return { provider, calls };
}

const noSleep = { sleep: async () => {} };

test("passes the request to the provider and returns its reply", async () => {
  const { provider, calls } = adapter(async () => ({ text: "hello" }));
  const gateway = createGateway({ provider, timeoutMs: 1000 });
  assert.deepEqual(await gateway.complete(request), { text: "hello" });
  assert.deepEqual(calls, [request]);
});

test("times out, aborts the provider call, and does not retry", async () => {
  let aborted = false;
  const { provider, calls } = adapter(
    (_n, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      }),
  );
  const gateway = createGateway({ provider, timeoutMs: 20, ...noSleep });
  await assert.rejects(gateway.complete(request), (error: unknown) => {
    assert.ok(error instanceof GatewayError);
    assert.equal(error.kind, "timeout");
    assert.equal(error.message, "fake: No reply within 20 ms");
    return true;
  });
  assert.equal(aborted, true);
  assert.equal(calls.length, 1);
});

test("retries a transient failure once, then succeeds", async () => {
  const delays: number[] = [];
  const { provider, calls } = adapter(async (n) => {
    if (n === 1) throw new ProviderError("unavailable", "connection reset");
    return { text: "recovered" };
  });
  const gateway = createGateway({ provider, timeoutMs: 1000, retryDelayMs: 300, sleep: async (ms) => void delays.push(ms) });
  assert.deepEqual(await gateway.complete(request), { text: "recovered" });
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [300]);
});

test("gives up after maxRetries and reports the last error", async () => {
  const { provider, calls } = adapter(async () => {
    throw new ProviderError("rate_limit", "too many requests");
  });
  const gateway = createGateway({ provider, timeoutMs: 1000, maxRetries: 2, ...noSleep });
  await assert.rejects(gateway.complete(request), (error: unknown) => {
    assert.ok(error instanceof GatewayError);
    assert.equal(error.kind, "rate_limit");
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(calls.length, 3);
});

test("does not retry auth or bad-request errors", async () => {
  for (const kind of ["auth", "bad_request"] as const) {
    const { provider, calls } = adapter(async () => {
      throw new ProviderError(kind, "rejected");
    });
    const gateway = createGateway({ provider, timeoutMs: 1000, ...noSleep });
    await assert.rejects(gateway.complete(request), (e: unknown) => e instanceof GatewayError && e.kind === kind && !e.retryable);
    assert.equal(calls.length, 1);
  }
});

test("wraps unexpected errors as unknown and never leaks keys", async () => {
  const { provider } = adapter(async () => {
    throw new Error("request failed with key sk-ant-api03-abcdefghijklmnop");
  });
  const gateway = createGateway({ provider, timeoutMs: 1000, ...noSleep });
  await assert.rejects(gateway.complete(request), (error: unknown) => {
    assert.ok(error instanceof GatewayError);
    assert.equal(error.kind, "unknown");
    assert.equal(error.message, "fake: request failed with key [REDACTED]");
    return true;
  });
});

test("redactSecrets covers common credential formats", () => {
  assert.equal(redactSecrets("x-api-key: abcdefgh12345"), "x-api-key: [REDACTED]");
  assert.equal(redactSecrets("Authorization: Bearer abc.def.ghi-12345"), "Authorization: Bearer [REDACTED]");
  assert.equal(redactSecrets("nothing secret here"), "nothing secret here");
});
