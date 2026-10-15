import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createCuaTransport, cuaEnvironment } from "./cua-client.ts";

const fixture = fileURLToPath(new URL("./fake-cua.fixture.mjs", import.meta.url));
const make = (extra: Parameters<typeof createCuaTransport>[0] = {}) =>
  createCuaTransport({ command: process.execPath, args: [fixture], ...extra });

test("calls a tool and returns its text, data and error flag", async () => {
  const cua = make();
  try {
    const r = await cua.call("echo", { text: "hi" });
    assert.deepEqual(r, { text: "hi", data: { args: { text: "hi" } }, isError: false, refusal: undefined });
  } finally {
    await cua.close();
  }
});

test("a refusal comes back with its code", async () => {
  const cua = make();
  try {
    const r = await cua.call("refuse", {});
    assert.equal(r.isError, true);
    assert.deepEqual(r.refusal, { code: "denied", message: "not allowed" });
  } finally {
    await cua.close();
  }
});

test("a refusal in the real driver's flat shape still comes back with its code", async () => {
  const cua = make();
  try {
    const r = await cua.call("refuse_flat", {});
    assert.equal(r.isError, true);
    assert.deepEqual(r.refusal, { code: "same_pid_keyboard_ambiguity", message: "pid 9 owns 1 other window" });
  } finally {
    await cua.close();
  }
});

test("an error with no code has no refusal", async () => {
  const cua = make();
  try {
    const r = await cua.call("error_plain", {});
    assert.equal(r.isError, true);
    assert.equal(r.refusal, undefined);
  } finally {
    await cua.close();
  }
});

test("starts Cua in standard mode with telemetry off, whatever the caller's environment says", async () => {
  const cua = make({ env: { ...process.env, CUA_DRIVER_PERMISSION_MODE: "unrestricted", CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS: "1", CUA_TELEMETRY_ENABLED: "true" } });
  try {
    const r = await cua.call("env", {});
    assert.deepEqual(r.data, { mode: "standard", bypass: null, telemetry: "false", telemetryRs: "0" });
  } finally {
    await cua.close();
  }
});

test("cuaEnvironment also strips the capability-manifest overrides", () => {
  const env = cuaEnvironment({ CUA_DRIVER_CAPABILITY_MANIFEST_FILE: "/x", CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED: "1", PATH: "/bin" });
  assert.equal(env.CUA_DRIVER_CAPABILITY_MANIFEST_FILE, undefined);
  assert.equal(env.CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED, undefined);
  assert.equal(env.PATH, "/bin");
});

test("if Cua dies mid-call the call fails, and the next call starts it again", async () => {
  const cua = make();
  try {
    const before = (await cua.call("pid", {})).data.pid;
    await assert.rejects(cua.call("crash", {}), /stopped unexpectedly/);
    const after = (await cua.call("pid", {})).data.pid;
    assert.notEqual(after, before);
  } finally {
    await cua.close();
  }
});

test("cancelling rejects at once and tells Cua", async () => {
  const cua = make();
  try {
    await cua.call("echo", { text: "warm up" }); // started, so the cancel below is for a call that is in flight
    const ac = new AbortController();
    const slow = cua.call("slow", {}, ac.signal);
    setTimeout(() => ac.abort(), 30);
    await assert.rejects(slow, /Cancelled/);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await cua.call("cancelled", {})).data.cancelled, 1);
  } finally {
    await cua.close();
  }
});

test("cancelling while Cua is still starting is not missed", async () => {
  // Cua takes a moment to start. Cancel during that moment: the call must reject now, not after the 30 s timeout.
  const cua = make({ callTimeoutMs: 20_000 });
  try {
    const ac = new AbortController();
    const started = Date.now();
    const slow = cua.call("slow", {}, ac.signal);
    setTimeout(() => ac.abort(), 5); // after the call began, long before the fake Cua has finished starting
    await assert.rejects(slow, /Cancelled/);
    assert.ok(Date.now() - started < 5000, "rejected promptly");
  } finally {
    await cua.close();
  }
});

test("an already-cancelled call never reaches Cua", async () => {
  const cua = make();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(cua.call("echo", { text: "x" }, ac.signal), /Cancelled/);
  await cua.close();
});

test("a call that gets no answer times out", async () => {
  const cua = make({ callTimeoutMs: 80 });
  try {
    await assert.rejects(cua.call("slow", {}), /did not answer within/);
  } finally {
    await cua.close();
  }
});

test("Cua is stopped when idle and started again on the next call", async () => {
  const cua = make({ idleMs: 60 });
  try {
    const first = (await cua.call("pid", {})).data.pid;
    await new Promise((r) => setTimeout(r, 200));
    assert.throws(() => process.kill(first, 0), /ESRCH/);
    const second = (await cua.call("pid", {})).data.pid;
    assert.notEqual(second, first);
  } finally {
    await cua.close();
  }
});

test("a missing Cua binary gives a plain error", async () => {
  const cua = createCuaTransport({ command: "/nonexistent/cua-driver" });
  await assert.rejects(cua.call("echo", {}), /Could not start Cua Driver/);
  await cua.close();
});

test("close stops the process", async () => {
  const cua = make();
  const pid = (await cua.call("pid", {})).data.pid;
  await cua.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

// 2026-10-16 (code check): the exit handler of an old Cua process cleared the shared state and rejected every pending request. When a new call had
// started a second process while the first was still exiting, the second process's request was rejected ("stopped unexpectedly") and a third was spawned.
test("an old process that exits late does not reject the request of the new process", async () => {
  const cua = make({ env: { ...process.env, CUA_FIXTURE_EXIT_DELAY_MS: "300" } });
  try {
    await cua.call("echo", { text: "first process is up" });
    const closing = cua.close(); // the first process is told to stop and takes about 300 ms to go
    await new Promise((r) => setTimeout(r, 50));
    const r = await cua.call("later", { ms: 700 }); // the second process answers after the first has exited
    assert.equal(r.text, "later");
    await closing;
  } finally {
    await cua.close();
  }
});

