import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSupervisor, type RuntimeEvent, type SupervisorStatus } from "./supervisor.ts";

const fake = join(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-runtime.mjs");

function harness(env: NodeJS.ProcessEnv = {}, extra: Partial<Parameters<typeof createSupervisor>[0]> = {}) {
  const events: RuntimeEvent[] = [];
  const statuses: SupervisorStatus[] = [];
  const waiters: { match: (e: RuntimeEvent) => boolean; resolve: (e: RuntimeEvent) => void }[] = [];
  const supervisor = createSupervisor({
    launch: { command: process.execPath, args: [fake], cwd: process.cwd(), env: { ...process.env, ...env } },
    onEvent: (event) => {
      events.push(event);
      for (const w of [...waiters]) if (w.match(event)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(event));
    },
    onStatus: (s) => statuses.push(s),
    ...extra,
  });
  const next = (type: string) => {
    const seen = events.find((e) => e.type === type && !(e as { _seen?: boolean })._seen);
    if (seen) {
      (seen as { _seen?: boolean })._seen = true;
      return Promise.resolve(seen);
    }
    return new Promise<RuntimeEvent>((resolve) => waiters.push({ match: (e) => e.type === type, resolve: (e) => ((e as { _seen?: boolean })._seen = true, resolve(e)) }));
  };
  return { supervisor, events, statuses, next };
}

const settle = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail("timed out waiting for a condition");
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("forwards the runtime's events and writes commands as single lines", async () => {
  const h = harness();
  h.supervisor.start();
  const ready = await h.next("ready");
  assert.equal(ready.protocol, 1);
  assert.equal(h.supervisor.status().state, "running");
  assert.equal(h.supervisor.send({ type: "chats.list" }), true);
  const chats = (await h.next("chats")) as RuntimeEvent & { chats: unknown[] };
  assert.equal(chats.chats.length, 2);
  // Text with line breaks stays one protocol line: the fake runtime parses it as JSON, or answers with an error event.
  h.supervisor.send({ type: "text.send", text: "line one\nline two" });
  const transcript = (await h.next("transcript")) as RuntimeEvent & { text: string };
  assert.equal(transcript.text, "line one\nline two");
  assert.equal(h.events.filter((e) => e.type === "error").length, 0);
  await h.supervisor.stop();
  assert.equal(h.supervisor.status().state, "stopped");
});

test("a requested stop is a clean quit and does not restart", async () => {
  const h = harness();
  h.supervisor.start();
  await h.next("ready");
  await h.supervisor.stop();
  assert.deepEqual(h.statuses.map((s) => s.state), ["running", "stopped"]);
  assert.equal(h.supervisor.send({ type: "chats.list" }), false);
});

test("exit code 78 is a configuration error with the runtime's own message, and is not restarted", async () => {
  const h = harness({ FAKE_RUNTIME_EXIT: "78" });
  h.supervisor.start();
  await settle(() => h.supervisor.status().state === "configError");
  assert.deepEqual(h.supervisor.status(), { state: "configError", message: "fake runtime exits with 78" });
});

test("an unexpected exit schedules a restart with the policy's first delay, then runs again", async () => {
  const timers: { fn: () => void; ms: number }[] = [];
  const h = harness({ FAKE_RUNTIME_EXIT: "1" }, { setTimer: (fn, ms) => (timers.push({ fn, ms }), { cancel() {} }) });
  h.supervisor.start();
  await settle(() => h.supervisor.status().state === "restarting");
  assert.deepEqual(h.supervisor.status(), { state: "restarting", afterSeconds: 1 });
  assert.equal(timers.at(-1)?.ms, 1000);
  assert.equal(h.supervisor.send({ type: "chats.list" }), false, "commands are dropped, not queued, while it is down");
  timers.at(-1)!.fn();
  await settle(() => h.statuses.filter((s) => s.state === "running").length === 2);
});

test("a runtime that cannot be started reports failure instead of throwing", async () => {
  const h = harness({}, { launch: { command: join(process.cwd(), "no-such-binary"), args: [], cwd: process.cwd() } });
  h.supervisor.start();
  await settle(() => h.supervisor.status().state === "restarting" || h.supervisor.status().state === "failed");
  await h.supervisor.stop();
});
