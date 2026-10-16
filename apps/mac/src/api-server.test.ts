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
  let clock = 0; // many wrong tokens in a row would trip the ADR-121 lock; the clock moves on so they are not within one minute
  const { api, port, token } = await boot({ now: () => (clock += 10_000) });
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

// 2026-10-16 (security review): the token could answer every card, including "allow this click / command". Keshab chose: plans and
// retries only; risky-action cards, soul changes and skill installs are answered in the window or on Telegram.
test("needs: the API answers a plan, but a risky-action card is refused and listed as not answerable", async () => {
  const approved: number[] = [];
  const answered: string[] = [];
  const planStore = {
    ...store,
    list: () => [{ jobs: [{ id: 8, helper: "h1", state: "queued", planStatus: "awaiting", planSummary: "Do it in 3 steps", task: "write" }], routines: [], proposals: [], name: "Scout" }],
    approvePlan: (n: number) => void approved.push(n),
    rejectPlan: () => {},
  } as unknown as NonNullable<ApiServerOptions["helpers"]>;
  const { api, port, token } = await boot({
    helpers: planStore,
    approvals: { pending: () => [{ id: "q1", summary: "Click Send", reason: "it sends" }] as any, answer: (id: string) => void answered.push(id) },
  });
  try {
    const list = await call(port, "GET", "/v1/needs", { token });
    const byKey = Object.fromEntries((list.json.data.needs as { key: string; answerable: boolean; actions: unknown[] }[]).map((n) => [n.key, n]));
    assert.equal(byKey["plan-8"]!.answerable, true);
    assert.equal(byKey["plan-8"]!.actions.length, 2, "approve and reject");
    assert.equal(byKey["ask-q1"]!.answerable, false);
    assert.deepEqual(byKey["ask-q1"]!.actions, [], "no button to press");

    const denied = await call(port, "POST", "/v1/needs/ask-q1", { token, body: '{"action":"allow"}' });
    assert.equal(denied.status, 403);
    assert.match(denied.json.error, /ATOM window or on Telegram/);
    assert.deepEqual(answered, [], "the card was not answered");

    const plan = await call(port, "POST", "/v1/needs/plan-8", { token, body: '{"action":"approve"}' });
    assert.equal(plan.status, 200);
    assert.deepEqual(approved, [8]);
  } finally {
    api.stop();
  }
});

// 2026-10-16 (code check): `new URL("//", base)` threw before the token check, outside any try. handle() rejected, nothing caught it, and the app's
// crash handler ended ATOM: no token needed, from any web page that could reach 127.0.0.1.
test("a request with an address the URL parser rejects gets an answer and the app keeps running", async () => {
  const rejections: unknown[] = [];
  const onRejection = (e: unknown) => rejections.push(e);
  process.on("unhandledRejection", onRejection);
  const { api, port, token } = await boot();
  try {
    for (const path of ["//", "//%", "//x//"]) {
      const anon = await call(port, "GET", path);
      assert.equal(anon.status, 401, `${path}: without a token it is refused like everything else`);
      const authed = await call(port, "GET", path, { token });
      assert.ok(authed.status === 400 || authed.status === 404, `${path}: ${authed.status}`);
    }
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(rejections.length, 0, "no unhandled rejection: nothing ended the app");
    assert.equal((await call(port, "GET", "/v1/tasks", { token })).status, 200, "the API still answers");
  } finally {
    process.off("unhandledRejection", onRejection);
    api.stop();
  }
});

test("a broken percent-encoding in a Needs you key is a 400, not a 500", async () => {
  const { api, port, token } = await boot();
  try {
    const r = await call(port, "POST", "/v1/needs/%E0%A4%A", { token, body: '{"action":"approve"}' });
    assert.equal(r.status, 400);
  } finally {
    api.stop();
  }
});

// 2026-10-16 (code check): API turns were queued with no limit, so one hung answer held every later /v1/chat and /v1/goals forever (Telegram had a limit).
test("a hung API turn is given up on after the limit and the next request is served", async () => {
  let n = 0;
  const { api, port, token } = await boot({
    turnTimeoutMs: 40,
    ask: (t: string) => (++n === 1 ? new Promise<string>(() => {}) : Promise.resolve(`echo:${t}`)),
  } as never);
  try {
    const first = await call(port, "POST", "/v1/chat", { token, body: '{"text":"one"}' });
    assert.equal(first.status, 504, "the hung turn is answered with a timeout");
    const second = await call(port, "POST", "/v1/chat", { token, body: '{"text":"two"}' });
    assert.equal(second.status, 200);
    assert.equal(second.json.data.answer, "echo:two");
  } finally {
    api.stop();
  }
});

// ADR-121: the phone page over Tailscale Serve. The server stays on 127.0.0.1; Tailscale forwards one private name to it.
import { connect } from "node:net";

function raw(port: number, path: string, headers: Record<string, string | null> = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }>((resolve, reject) => {
    const sent: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) if (v !== null) sent[k] = v;
    const req = request({ host: "127.0.0.1", port, method: "GET", path, headers: sent, setHost: !("host" in headers) }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("ADR-121: the page and its two files need no token, and carry the strict headers", async () => {
  const { api, port } = await boot();
  try {
    for (const [path, type] of [["/app", "text/html"], ["/app.js", "text/javascript"], ["/app.css", "text/css"]] as const) {
      const r = await raw(port, path);
      assert.equal(r.status, 200, path);
      assert.match(String(r.headers["content-type"]), new RegExp(type), path);
      assert.equal(r.headers["cache-control"], "no-store");
      assert.equal(r.headers["x-frame-options"], "DENY");
      assert.equal(r.headers["x-content-type-options"], "nosniff");
      assert.match(String(r.headers["content-security-policy"]), /default-src 'self'.*base-uri 'none'.*form-action 'none'/);
      assert.ok(r.text.length > 100, path);
    }
    assert.equal((await call(port, "GET", "/v1/tasks")).status, 401, "data still needs the token");
    assert.equal((await raw(port, "/app", {})).status, 200);
    assert.equal((await raw(port, "/app/../v1/tasks")).status, 401, "no other path is public");
  } finally {
    api.stop();
  }
});

test("ADR-121: the page holds no script from outside, no eval, no innerHTML, and calls only its own server", async () => {
  const { api, port } = await boot();
  try {
    const html = (await raw(port, "/app")).text;
    const js = (await raw(port, "/app.js")).text;
    const css = (await raw(port, "/app.css")).text;
    assert.ok(!/<script(?![^>]*src="\/app\.js")/.test(html) && !/<script[^>]*>\s*[^<\s]/.test(html), "only /app.js, no inline script");
    assert.ok(!/https?:\/\//.test(html + js + css), "no address of another site");
    assert.ok(!/\beval\b|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js), "task text is shown as text only");
    assert.ok(!/style="/.test(html), "no inline style (the policy forbids it)");
    assert.match(html, /name="viewport"/);
    assert.match(js, /\/v1\/needs/);
    assert.match(js, /\/v1\/tasks/);
    assert.match(js, /\/v1\/goals/);
  } finally {
    api.stop();
  }
});

test("ADR-121: the Host header must be this machine or the one named in ATOM_API_HOST; anything else is 403, with or without a token", async () => {
  const { api, port, token } = await boot({ host: "Mac-Mini.Tail1234.ts.net" });
  try {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, "localhost", "mac-mini.tail1234.ts.net", "MAC-MINI.TAIL1234.TS.NET", `mac-mini.tail1234.ts.net:443`]) {
      assert.equal((await raw(port, "/app", { host })).status, 200, host);
    }
    for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1.evil.example", "mac-mini.tail1234.ts.net.evil.example", "", "tail1234.ts.net", "[::1]x"]) {
      assert.equal((await raw(port, "/app", { host })).status, 403, `page with Host "${host}"`);
      const data = await raw(port, "/v1/tasks", { host, authorization: `Bearer ${token}` });
      assert.equal(data.status, 403, `data with Host "${host}"`);
    }
    // No Host header at all (HTTP/1.0): refused too.
    const status = await new Promise<string>((resolve) => {
      const s = connect(port, "127.0.0.1", () => s.write("GET /app HTTP/1.0\r\n\r\n"));
      let out = "";
      s.on("data", (c) => (out += c));
      s.on("close", () => resolve(out.split("\r\n")[0] ?? ""));
    });
    assert.match(status, /403/);
  } finally {
    api.stop();
  }
});

test("ADR-121: without ATOM_API_HOST only the local names are allowed", async () => {
  const { api, port } = await boot();
  try {
    assert.equal((await raw(port, "/app", { host: "mac-mini.tail1234.ts.net" })).status, 403);
    assert.equal((await raw(port, "/app", { host: `localhost:${port}` })).status, 200);
  } finally {
    api.stop();
  }
});

test("ADR-121: ten wrong tokens in a minute lock the API for a minute, and it opens again after", async () => {
  let now = 1_000_000;
  const { api, port, token } = await boot({ now: () => now });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await call(port, "GET", "/v1/tasks", { token: "0".repeat(64) })).status, 401, `try ${i + 1}`);
    assert.equal((await call(port, "GET", "/v1/tasks", { token })).status, 429, "locked, even for the right token");
    assert.equal((await raw(port, "/app")).status, 200, "the public page stays reachable");
    now += 61_000;
    assert.equal((await call(port, "GET", "/v1/tasks", { token })).status, 200, "open again");
    for (let i = 0; i < 9; i++) await call(port, "GET", "/v1/tasks", { token: "1".repeat(64) });
    now += 61_000; // the old failures are outside the minute
    for (let i = 0; i < 9; i++) await call(port, "GET", "/v1/tasks", { token: "1".repeat(64) });
    assert.equal((await call(port, "GET", "/v1/tasks", { token })).status, 200, "nine in each minute is not enough to lock");
  } finally {
    api.stop();
  }
});

test("ADR-121: a phone can send a goal with the token (the same route as any client)", async () => {
  const { api, port, token } = await boot();
  try {
    const r = await call(port, "POST", "/v1/goals", { token, body: JSON.stringify({ goal: "check the weather" }) });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
  } finally {
    api.stop();
  }
});

// 2026-10-16 (security review): a plain request with no Authorization header (a web page can send one) is not a guess and does not lock the owner out.
test("requests with no Authorization header do not count towards the wrong-token lock", async () => {
  const { api, port, token } = await boot();
  try {
    for (let i = 0; i < 30; i++) assert.equal((await call(port, "GET", "/v1/tasks")).status, 401);
    assert.equal((await call(port, "GET", "/v1/tasks", { token })).status, 200, "the owner is not locked out");
    for (let i = 0; i < 10; i++) await call(port, "GET", "/v1/tasks", { token: "0".repeat(64) });
    assert.equal((await call(port, "GET", "/v1/tasks", { token })).status, 429, "ten real guesses still lock");
  } finally {
    api.stop();
  }
});

// 2026-10-16: a chat that the window is answering in answers the phone with a 409 and a clear line, not a 502.
test("a busy chat is a 409 with the line from the guard", async () => {
  const { ChatBusyError } = await import("./chat-turns.ts");
  const { api, port, token } = await boot({ ask: async () => { throw new ChatBusyError("The ATOM window is answering in this chat. Try again in a moment."); } });
  try {
    const r = await call(port, "POST", "/v1/chat", { token, body: JSON.stringify({ text: "hi", chatId: "x" }) });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /The ATOM window is answering in this chat/);
  } finally {
    api.stop();
  }
});
