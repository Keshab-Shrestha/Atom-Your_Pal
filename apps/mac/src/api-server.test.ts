import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createApiServer, parsePort, readOrCreateToken, type ApiServerOptions } from "./api-server.ts";

// ADR-098 item 5: the local API. Real loopback server on a random port, fake store, no real ATOM.

const dir = mkdtempSync(join(tmpdir(), "atom-api-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const log = { debug() {}, info() {}, warn() {}, error() {} } as unknown as ApiServerOptions["log"];
const logged: string[] = [];
const spyLog = { ...log, info: (e: string, f?: unknown) => logged.push(JSON.stringify([e, f])), warn: (e: string, f?: unknown) => logged.push(JSON.stringify([e, f])), error: (e: string, f?: unknown) => logged.push(JSON.stringify([e, f])) } as unknown as ApiServerOptions["log"];

const job = { id: 5, helper: "h1", state: "done", task: "do it", createdAt: new Date(0) };
const routines = [{ id: 1, webhook: true }, { id: 2, webhook: false }];
const started: number[] = [];
const store = {
  soul: () => ({ name: "Scout" }),
  list: () => [{ jobs: [job], routines, proposals: [], name: "Scout" }],
  managers: () => [],
  get: (id: number) => (id === 5 ? job : undefined),
  report: () => undefined,
  goal: () => undefined,
  skillDrafts: () => [],
  skillEdits: () => [],
  skillHubPending: () => [],
  onChange: () => () => {},
  // ADR-110 (N3): with a native start the store makes no task (null).
  startRoutine: (id: number, start?: (r: unknown) => boolean) => (started.push(id), start ? (start(routines.find((r) => r.id === id)), null) : { id: 99 }),
} as unknown as NonNullable<ApiServerOptions["helpers"]>;

let seq = 0;
async function boot(extra: Partial<ApiServerOptions> = {}) {
  const tokenFile = join(dir, `token-${seq}`);
  const api = createApiServer({
    log, port: String(47900 + Math.floor(Math.random() * 90) + (seq++ % 5) * 100), tokenFile, helpers: store,
    approvals: { pending: () => [], answer() {} }, describe: (e) => String(e), ask: async (t) => `echo:${t}`, said: () => undefined, startRoutine: () => true, ...extra,
  });
  const status = await api.set(true);
  assert.equal(status.on, true, status.error);
  return { api, port: status.port, token: readFileSync(tokenFile, "utf8").trim() };
}

function call(port: number, method: string, path: string, opts: { token?: string; auth?: string; body?: string; host?: string } = {}) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const headers: Record<string, string> = {};
    const auth = opts.auth ?? (opts.token ? `Bearer ${opts.token}` : undefined);
    if (auth) headers.authorization = auth;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const req = request({ host: opts.host ?? "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

test("token file: made with mode 0600, reused, bad content refused", () => {
  const file = join(dir, "t1");
  const token = readOrCreateToken(file);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(readOrCreateToken(file), token);
  writeFileSync(file, "short\n");
  assert.throws(() => readOrCreateToken(file), /valid token/);
});

test("parsePort accepts ports and rejects the rest", () => {
  assert.equal(parsePort(undefined), 4790);
  assert.equal(parsePort(" "), 4790);
  assert.equal(parsePort("8080"), 8080);
  for (const bad of ["0", "65536", "abc", "1.5", "-1"]) assert.throws(() => parsePort(bad), /port/, bad);
});

test("every route needs the right token", async () => {
  const { api, port, token } = await boot();
  try {
    for (const [m, p] of [["GET", "/v1/tasks"], ["GET", "/v1/needs"], ["POST", "/v1/chat"], ["POST", "/v1/hooks/1"], ["GET", "/nothing"]] as const) {
      assert.equal((await call(port, m, p)).status, 401, `${m} ${p} no token`);
      assert.equal((await call(port, m, p, { token: "0".repeat(64) })).status, 401, `${m} ${p} wrong token`);
    }
    for (const auth of ["", "Bearer", "Bearer ", token, `Basic ${token}`, `bearer ${token}`, `Bearer ${token}x`, `Bearer ${token.slice(1)}`]) {
      assert.equal((await call(port, "GET", "/v1/tasks", { auth })).status, 401, auth);
    }
    const ok = await call(port, "GET", "/v1/tasks", { token });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.tasks[0].worker, "Scout");
  } finally {
    api.stop();
  }
});

test("401 body never holds the token; log never holds token or body", async () => {
  const { api, port, token } = await boot({ log: spyLog });
  try {
    const r = await call(port, "POST", "/v1/chat", { token, body: JSON.stringify({ text: "secret-words" }) });
    assert.equal(r.status, 200);
    const bad = await call(port, "GET", "/v1/tasks", { token: "1".repeat(64) });
    assert.ok(!JSON.stringify(bad.json).includes("1".repeat(64)));
    const all = logged.join("\n");
    assert.ok(!all.includes(token) && !all.includes("secret-words") && !all.includes("1".repeat(64)));
  } finally {
    api.stop();
  }
});

test("listens on loopback only", async (t) => {
  const { api, port, token } = await boot();
  try {
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
    if (!lan) return t.skip("no non-loopback interface");
    await assert.rejects(call(port, "GET", "/v1/tasks", { token, host: lan.address }), /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/);
  } finally {
    api.stop();
  }
});

test("unknown route 404, wrong method 404, bad JSON and bad shapes 400", async () => {
  const { api, port, token } = await boot();
  try {
    assert.equal((await call(port, "GET", "/v1/nope", { token })).status, 404);
    assert.equal((await call(port, "DELETE", "/v1/tasks", { token })).status, 404);
    assert.equal((await call(port, "GET", "/v1/chat", { token })).status, 404);
    for (const body of ["{nope", "[1]", "null", "{}", '{"text":""}', '{"text":5}', '{"text":"hi","chatId":"a b"}', '{"text":"hi","chatId":"../x"}', `{"text":"hi","chatId":"${"a".repeat(41)}"}`]) {
      assert.equal((await call(port, "POST", "/v1/chat", { token, body })).status, 400, body);
    }
    assert.equal((await call(port, "POST", "/v1/chat", { token, body: '{"text":"hi","chatId":"ok_1-x"}' })).status, 200);
    // ADR-110 (N3): "goal-…" is a goal's chat ("api-goal-<id>"): /v1/chat never shares it.
    for (const chatId of ["goal-1760000000000", "GOAL-1", "goal-x"]) {
      const refused = await call(port, "POST", "/v1/chat", { token, body: JSON.stringify({ text: "hi", chatId }) });
      assert.equal(refused.status, 400, chatId);
      assert.match(refused.json.error, /goal-/);
    }
    assert.equal((await call(port, "POST", "/v1/chat", { token, body: '{"text":"hi","chatId":"my-goal-1"}' })).status, 200);
  } finally {
    api.stop();
  }
});

test("a body over 64 KB gets 413", async () => {
  const { api, port, token } = await boot();
  try {
    const big = JSON.stringify({ text: "x".repeat(70 * 1024) });
    const r = await call(port, "POST", "/v1/chat", { token, body: big });
    assert.equal(r.status, 413);
  } finally {
    api.stop();
  }
});

test("ids must be whole numbers; unknown ids 404", async () => {
  const { api, port, token } = await boot();
  try {
    for (const id of ["abc", "0", "-3", "1.5", "1e3x"]) assert.equal((await call(port, "GET", `/v1/tasks/${id}`, { token })).status, 400, id);
    assert.equal((await call(port, "GET", "/v1/tasks/6", { token })).status, 404);
    assert.equal((await call(port, "GET", "/v1/tasks/5", { token })).status, 200);
    assert.equal((await call(port, "GET", "/v1/tasks?state=bogus", { token })).status, 400);
    assert.equal((await call(port, "GET", "/v1/tasks/5/extra", { token })).status, 404);
  } finally {
    api.stop();
  }
});

test("webhook: only a routine with webhook on starts; no token no start", async () => {
  const { api, port, token } = await boot();
  try {
    started.length = 0;
    assert.equal((await call(port, "POST", "/v1/hooks/1")).status, 401);
    assert.equal((await call(port, "POST", "/v1/hooks/2", { token })).status, 403);
    assert.equal((await call(port, "POST", "/v1/hooks/77", { token })).status, 404);
    assert.equal((await call(port, "POST", "/v1/hooks/x", { token })).status, 400);
    assert.deepEqual(started, []);
    const ok = await call(port, "POST", "/v1/hooks/1", { token });
    assert.equal(ok.status, 200);
    assert.deepEqual(started, [1]);
  } finally {
    api.stop();
  }
});

test("ADR-110 N3: a webhook starts the routine natively: no task (taskId null)", async () => {
  const native: number[] = [];
  const { api, port, token } = await boot({ said: () => undefined, startRoutine: (r) => (native.push(r.id), true) });
  try {
    started.length = 0;
    const ok = await call(port, "POST", "/v1/hooks/1", { token });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.data, { taskId: null });
    assert.deepEqual([started, native], [[1], [1]]);
  } finally {
    api.stop();
  }
});

test("needs: key pattern and unknown key/action are refused", async () => {
  const { api, port, token } = await boot({ approvals: { pending: () => [{ id: "q1", summary: "s", reason: "r" }] as any, answer() {} } });
  try {
    assert.equal((await call(port, "POST", "/v1/needs/bad%20key", { token, body: '{"action":"allow"}' })).status, 400);
    assert.equal((await call(port, "POST", "/v1/needs/ask-nope", { token, body: '{"action":"allow"}' })).status, 404);
    assert.equal((await call(port, "POST", "/v1/needs/ask-q1", { token, body: '{"action":"explode"}' })).status, 400);
    assert.equal((await call(port, "POST", "/v1/needs/ask-q1", { token, body: '{}' })).status, 400);
    const ok = await call(port, "POST", "/v1/needs/ask-q1", { token, body: '{"action":"Allow"}' });
    assert.equal(ok.json.data.said, "Allowed.");
    const list = await call(port, "GET", "/v1/needs", { token });
    assert.ok(!JSON.stringify(list.json).includes("a:q1"), "button data is not leaked");
  } finally {
    api.stop();
  }
});

test("an ATOM failure is 502 and an unexpected throw is 500 without details", async () => {
  const { api, port, token } = await boot({ ask: async () => { throw new Error("boom-detail"); } });
  try {
    const r = await call(port, "POST", "/v1/chat", { token, body: '{"text":"hi"}' });
    assert.equal(r.status, 502);
  } finally {
    api.stop();
  }
  const b = await boot({ helpers: { ...store, list: () => { throw new Error("db-secret"); } } as any });
  try {
    const r = await call(b.port, "GET", "/v1/tasks", { token: b.token });
    assert.equal(r.status, 500);
    assert.ok(!JSON.stringify(r.json).includes("db-secret"));
  } finally {
    b.api.stop();
  }
});

test("a port in use gives an error status, not a throw", async () => {
  const a = await boot();
  try {
    const tokenFile = join(dir, "token-dup");
    const second = createApiServer({ log, port: String(a.port), tokenFile, approvals: { pending: () => [], answer() {} }, describe: String, ask: async () => "", said: () => undefined });
    const s = await second.set(true);
    assert.equal(s.on, false);
    assert.match(s.error ?? "", /in use/);
  } finally {
    a.api.stop();
  }
});

test("ADR-110 N3: a goal is a turn in its own chat api-goal-<id>; its status and report read that chat's job rows", async () => {
  const jobs: any[] = [];
  const reports = new Map<number, any>();
  const asked: [string, string | undefined][] = [];
  const nativeStore = {
    ...store,
    list: () => [{ jobs, routines: [], proposals: [], name: "Scout" }],
    get: (id: number) => jobs.find((j) => j.id === id),
    report: (id: number) => reports.get(id),
    goal: () => { throw new Error("no legacy goals on the native engine"); },
  } as unknown as NonNullable<ApiServerOptions["helpers"]>;
  const { api, port, token } = await boot({
    helpers: nativeStore,
    said: (chat) => (chat.startsWith("api-goal-") ? "research mesh Wi-Fi" : undefined),
    ask: async (text, chatId) => {
      asked.push([text, chatId]);
      // The main agent hands it to Scout: the gate makes a job in this chat; an unrelated chat's job is not this goal's.
      jobs.push({ id: 7, helper: "h1", state: "running", task: "Find mesh Wi-Fi kits", chatId: `api-${chatId}`, createdAt: new Date(1000) });
      jobs.push({ id: 8, helper: "h1", state: "done", task: "other", chatId: "chat-1", createdAt: new Date(0) });
      return "Scout is on it.";
    },
  });
  const given = await call(port, "POST", "/v1/goals", { token, body: '{"goal":"research mesh Wi-Fi"}' });
  const id = given.json.data.goalId;
  assert.equal(typeof id, "number");
  assert.equal(given.json.data.answer, "Scout is on it.");
  assert.deepEqual(asked, [["research mesh Wi-Fi", `goal-${id}`]]);
  let status = await call(port, "GET", `/v1/goals/${id}`, { token });
  assert.equal(status.json.data.status, "running");
  assert.equal(status.json.data.goal, "research mesh Wi-Fi");
  assert.deepEqual(status.json.data.tasks.map((t: any) => t.id), [7]);
  jobs[0] = { ...jobs[0], state: "done", endedAt: new Date(5000) };
  reports.set(7, { title: "Mesh kits", summary: "Two kits fit.", body: "Two kits fit the flat.", sources: [{ title: "a", url: "https://a.example" }] });
  status = await call(port, "GET", `/v1/goals/${id}`, { token });
  assert.equal(status.json.data.status, "ended");
  assert.equal(status.json.data.endedAt, new Date(5000).toISOString());
  assert.equal(status.json.data.summary, "Two kits fit.");
  assert.deepEqual(status.json.data.report, { title: "Mesh kits", summary: "Two kits fit.", body: "Two kits fit the flat.", sources: [{ title: "a", url: "https://a.example" }] });
  const task = await call(port, "GET", "/v1/tasks/7", { token });
  assert.equal(task.json.data.report.summary, "Two kits fit.");
  assert.equal((await call(port, "GET", "/v1/goals/12345", { token })).status, 404);
  await api.set(false);
});

test("ADR-110 N3: a goal ATOM answers itself has goalId null", async () => {
  const { api, port, token } = await boot({ said: () => undefined, ask: async () => "It is 3 pm." });
  const given = await call(port, "POST", "/v1/goals", { token, body: '{"goal":"what time is it"}' });
  assert.deepEqual(given.json.data, { goalId: null, answer: "It is 3 pm." });
  await api.set(false);
});

// 2026-10-15: Settings had Copy token but no way to replace a token that was shown in a chat or a log.
test("regenerate: a running server rejects the old token at once and takes the new one; the file stays mode 0600", async () => {
  logged.length = 0;
  const { api, port, token } = await boot({ log: spyLog });
  try {
    assert.equal((await call(port, "GET", "/v1/tasks", { token })).status, 200);
    const status = api.regenerate();
    assert.equal(status.on, true);
    assert.equal(status.error, undefined);
    const fresh = readFileSync(join(dir, `token-${seq - 1}`), "utf8").trim();
    assert.match(fresh, /^[0-9a-f]{64}$/);
    assert.notEqual(fresh, token, "a different token");
    assert.equal((await call(port, "GET", "/v1/tasks", { token })).status, 401, "the old token is dead");
    assert.equal((await call(port, "GET", "/v1/tasks", { token: fresh })).status, 200, "the new one works");
    assert.equal(statSync(join(dir, `token-${seq - 1}`)).mode & 0o777, 0o600);
    const lines = logged.join("\n");
    assert.match(lines, /api\.token_regenerated/);
    assert.ok(!lines.includes(token) && !lines.includes(fresh), "no token in the log");
  } finally {
    api.stop();
  }
});

test("regenerate works while the server is off: the next start uses the new token", async () => {
  const tokenFile = join(dir, "token-off");
  const old = readOrCreateToken(tokenFile);
  const api = createApiServer({ log, port: String(47500 + Math.floor(Math.random() * 90)), tokenFile, approvals: { pending: () => [], answer() {} }, describe: (e) => String(e), ask: async () => "", said: () => undefined, startRoutine: () => true });
  const status = api.regenerate();
  assert.equal(status.on, false);
  assert.equal(status.error, undefined);
  assert.notEqual(readFileSync(tokenFile, "utf8").trim(), old);
  const started = await api.set(true);
  try {
    const fresh = readFileSync(tokenFile, "utf8").trim();
    assert.equal((await call(started.port, "GET", "/v1/needs", { token: old })).status, 401);
    assert.equal((await call(started.port, "GET", "/v1/needs", { token: fresh })).status, 200);
  } finally {
    api.stop();
  }
});
