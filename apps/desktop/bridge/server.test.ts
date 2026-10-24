import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHub } from "./hub.ts";
import { createBridgeServer, type BridgeServer } from "./server.ts";

const TOKEN = "t".repeat(64);
let bridge: BridgeServer;
let base = "";
let sent: object[] = [];
let accept = true;
const hub = createHub({ keepAliveMs: 60_000 });

before(async () => {
  const ui = mkdtempSync(join(tmpdir(), "atom-ui-"));
  mkdirSync(join(ui, "assets"));
  writeFileSync(join(ui, "index.html"), "<!doctype html><title>ATOM</title>");
  writeFileSync(join(ui, "assets/app.js"), "console.log(1)");
  writeFileSync(join(ui, "..", "secret.txt"), "outside the window folder");
  bridge = createBridgeServer({ hub, token: TOKEN, uiDir: ui, send: (c) => (accept ? (sent.push(c), true) : false), status: () => ({ state: "running", pid: 1 }) });
  const { port } = await bridge.listen(0);
  base = `http://127.0.0.1:${port}`;
});
after(() => bridge.close());

const auth = { authorization: `Bearer ${TOKEN}` };
const post = (body: string, headers: Record<string, string> = {}) => fetch(`${base}/command`, { method: "POST", headers: { ...auth, "content-type": "application/json", ...headers }, body });

test("the window's files are served with a strict content policy and need no token", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy")!, /default-src 'self'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await fetch(`${base}/assets/app.js`)).headers.get("content-type"), "text/javascript; charset=utf-8");
});

test("a path out of the window folder is not served", async () => {
  for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"]) {
    const res = await fetch(`${base}${path}`);
    assert.notEqual(await res.text(), "outside the window folder", path);
  }
});

test("a malformed escape in the address is a 400, not a crash", async () => {
  assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${base}/`)).status, 200);
});

test("events, status and commands need the token", async () => {
  for (const path of ["/events", "/status"]) assert.equal((await fetch(`${base}${path}`)).status, 401);
  assert.equal((await fetch(`${base}/command`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(`${base}/status`, { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await fetch(`${base}/status?token=${TOKEN}`)).status, 401, "a token in the URL is not accepted");
  assert.equal((await fetch(`${base}/status`, { headers: auth })).status, 200);
});

test("a request under another host name (DNS rebinding) is refused before anything else", async () => {
  // fetch() does not let a script set Host, so use a raw request.
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(`${base}/status`, { headers: { ...auth, host: "evil.example" } }, (res) => (res.resume(), resolve(res.statusCode ?? 0)));
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});

test("a command from another origin is refused, even with the token", async () => {
  const res = await post('{"type":"chats.list"}', { origin: "http://evil.example" });
  assert.equal(res.status, 403);
  assert.deepEqual(sent, []);
});

test("commands are checked for shape and forwarded; the window cannot quit the runtime", async () => {
  sent = [];
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post("[]")).status, 400);
  assert.equal((await post('{"type":5}')).status, 400);
  assert.equal((await post('{"type":"quit"}')).status, 403);
  assert.equal((await post('{"type":"text.send","text":"hi"}', { origin: base })).status, 202);
  assert.deepEqual(sent, [{ type: "text.send", text: "hi" }]);
  accept = false;
  const down = await post('{"type":"chats.list"}');
  assert.equal(down.status, 503);
  assert.match(((await down.json()) as { error: string }).error, /not running/);
  accept = true;
});

test("an oversized command is refused", async () => {
  const res = await post(JSON.stringify({ type: "text.send", text: "x".repeat(17 * 1024 * 1024) }));
  assert.equal(res.status, 413);
});

test("a window that connects mid-turn also gets the state and the question still waiting, and not one that closed", async () => {
  const fresh = createHub({ keepAliveMs: 60_000 });
  fresh.status({ state: "running", pid: 1 });
  fresh.event({ type: "state", state: "thinking" });
  fresh.event({ type: "approval.request", id: "a1", summary: "Click Send", reason: "r" });
  fresh.event({ type: "approval.request", id: "a2", summary: "Click Delete", reason: "r" });
  fresh.event({ type: "approval.closed", id: "a1" }); // another id: a2 is still waiting
  const read = async (hub: ReturnType<typeof createHub>) => {
    const text: string[] = [];
    const res = { writableLength: 0, writeHead() {}, on() {}, end() {}, write: (t: string) => text.push(t) } as never;
    hub.attach(res);
    return text.join("");
  };
  fresh.event({ type: "info", provider: "claude-plan", model: "m", providers: [] });
  const mid = await read(fresh);
  assert.match(mid, /"type":"info"/);
  assert.match(mid, /"state":"thinking"/);
  assert.match(mid, /"id":"a2"/);
  assert.doesNotMatch(mid, /"id":"a1"/);
  fresh.event({ type: "approval.closed", id: "a2" });
  assert.doesNotMatch(await read(fresh), /approval\.request/);
  fresh.event({ type: "approval.request", id: "a3", summary: "x", reason: "r" });
  fresh.event({ type: "state", state: "idle" });
  assert.doesNotMatch(await read(fresh), /approval\.request/, "an ended turn leaves no question behind");
  fresh.event({ type: "approval.request", id: "a4", summary: "x", reason: "r" });
  fresh.status({ state: "restarting", afterSeconds: 1 });
  const afterStop = await read(fresh);
  assert.doesNotMatch(afterStop, /approval\.request|"state":"thinking"|"type":"info"/, "a stopped runtime asks nothing");
  fresh.closeAll();
});

test("a window that connects gets the status, the last ready, then live events", async () => {
  hub.status({ state: "running", pid: 1 });
  hub.event({ type: "ready", protocol: 1 });
  const res = await fetch(`${base}/events`, { headers: auth });
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const until = async (needle: string) => {
    while (!text.includes(needle)) {
      const { value, done } = await reader.read();
      if (done) assert.fail(`stream ended before ${needle}`);
      text += decoder.decode(value);
    }
  };
  await until('"type":"ready"');
  assert.match(text, /event: status\ndata: {"state":"running","pid":1}/);
  hub.event({ type: "reply", text: "hello" });
  await until('"text":"hello"');
  await reader.cancel();
});
