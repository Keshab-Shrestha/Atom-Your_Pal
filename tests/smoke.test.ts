import { test } from "node:test";
import assert from "node:assert/strict";
import { enableApi, startRuntime } from "./smoke-harness.ts";

// Smoke test, no model: a real runtime starts in a temp folder, answers over the island protocol, serves the Local API and the phone page with its
// headers, and refuses what it must. It catches what mocks hide: wiring, startup, the HTTP layer. It runs with `pnpm test` (a few seconds).
// The model-using flows are in smoke.live.test.ts.

test("a real runtime starts, serves the Local API and the phone page, and refuses a bad token and a foreign host", { timeout: 120_000 }, async () => {
  const runtime = await startRuntime();
  try {
    const ready = runtime.events.find((e) => e.type === "ready")!;
    assert.equal(ready.provider, "claude-plan");
    await enableApi(runtime);

    // The phone page and its files need no token and carry the strict headers.
    for (const [path, type] of [["/app", "text/html"], ["/app.js", "text/javascript"], ["/app.css", "text/css"], ["/app.webmanifest", "application/manifest+json"], ["/app-icon.png", "image/png"]] as const) {
      const page = await runtime.api("GET", path, { token: null });
      assert.equal(page.status, 200, path);
      assert.ok(String(page.headers["content-type"]).includes(type), `${path}: ${page.headers["content-type"]}`);
      assert.match(String(page.headers["content-security-policy"]), /default-src 'self'/, path);
    }
    assert.match((await runtime.api("GET", "/app", { token: null })).text, /<title>ATOM<\/title>/);

    // Data needs the token; a foreign Host is refused first.
    assert.equal((await runtime.api("GET", "/v1/tasks", { token: null })).status, 401);
    assert.equal((await runtime.api("GET", "/v1/tasks", { token: "0".repeat(64) })).status, 401);
    const tasks = await runtime.api("GET", "/v1/tasks");
    assert.equal(tasks.status, 200);
    assert.deepEqual(tasks.json.data.tasks, []);
    const needs = await runtime.api("GET", "/v1/needs");
    assert.equal(needs.status, 200);
    assert.deepEqual(needs.json.data.needs, []);
    assert.equal((await runtime.api("GET", "/app", { token: null, host: "evil.example" })).status, 403);
    assert.equal((await runtime.api("GET", "/v1/tasks", { host: "evil.example" })).status, 403);
    assert.equal((await runtime.api("GET", "//")).status, 400, "an address the URL parser rejects is a 400, not a crash");
    assert.equal((await runtime.api("GET", "/v1/tasks")).status, 200, "and the runtime is still up");

    // The runtime answers a protocol command: the chats list comes back.
    runtime.send({ type: "chats.list" });
    await runtime.waitFor((e) => e.type === "chats", 10_000, "the chats list");
  } finally {
    await runtime.stop();
  }
});
