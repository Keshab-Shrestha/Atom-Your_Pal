import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHub } from "./hub.ts";
import { createInputStore } from "./input-store.ts";
import { createBridgeServer, type BridgeServer } from "./server.ts";

const TOKEN = "t".repeat(64);
let bridge: BridgeServer;
let uploads = "";
let inputDir = "";
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
  uploads = mkdtempSync(join(tmpdir(), "atom-up-test-"));
  inputDir = join(mkdtempSync(join(tmpdir(), "atom-in-test-")), "desktop");
  bridge = createBridgeServer({ hub, token: TOKEN, uiDir: ui, uploadDir: uploads, inputStore: createInputStore(inputDir), send: (c) => (accept ? (sent.push(c), true) : false), status: () => ({ state: "running", pid: 1 }) });
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

// ---------- uploads ----------

const upload = (name: string, body: BodyInit, headers: Record<string, string> = {}) =>
  fetch(`${base}/upload?name=${encodeURIComponent(name)}`, { method: "POST", headers: { ...auth, ...headers }, body });

test("an upload needs the token and the same origin", async () => {
  assert.equal((await fetch(`${base}/upload?name=a.txt`, { method: "POST", body: "x" })).status, 401);
  assert.equal((await upload("a.txt", "x", { origin: "http://evil.example" })).status, 403);
  assert.equal((await fetch(`${base}/upload?name=a.txt`, { headers: auth })).status, 405);
});

test("a staged file keeps its name, lands in its own folder inside the private root, and holds the bytes", async () => {
  const res = await upload("Notes 2026.txt", "hello world", { origin: base });
  assert.equal(res.status, 201);
  const { path, size } = (await res.json()) as { path: string; size: number };
  assert.equal(size, 11);
  assert.ok(path.startsWith(uploads), "inside the staging root");
  assert.equal(path.split(/[\\/]/).at(-1), "Notes 2026.txt");
  assert.equal(readFileSync(path, "utf8"), "hello world");
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("a name cannot climb out of its folder or carry control characters, and an empty name becomes 'file'", async () => {
  for (const [given, kept] of [["../../etc/passwd", "passwd"], ["..\\..\\boot.ini", "boot.ini"], ["a\u0000b\n.txt", "ab.txt"], ["", "file"], [".env", ".env"], ["id_rsa", "id_rsa"], ["..", "file"], ["...", "file"], ["CON.txt", "_CON.txt"], ["x".repeat(300) + ".md", ""]] as const) {
    const res = await upload(given, "x");
    assert.equal(res.status, 201, given);
    const { path } = (await res.json()) as { path: string };
    assert.ok(path.startsWith(uploads), `${given} stays inside`);
    const name = path.split(/[\\/]/).at(-1)!;
    if (kept) assert.equal(name, kept, given);
    else assert.ok(name.endsWith(".md") && [...name].length <= 120, "a long name is cut but keeps its extension");
  }
});

test("a file over 10 MB is refused, before and during the stream, and leaves nothing behind", async () => {
  const before = existsSync(uploads) ? (await import("node:fs")).readdirSync(uploads).length : 0;
  const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
  const declared = await upload("big.txt", big);
  assert.equal(declared.status, 413);
  const chunked = await fetch(`${base}/upload?name=big.txt`, { method: "POST", headers: auth, body: new ReadableStream({ start(c) { c.enqueue(big.subarray(0, 6_000_000)); c.enqueue(big.subarray(6_000_000)); c.close(); } }), duplex: "half" } as RequestInit);
  assert.equal(chunked.status, 413);
  const after = (await import("node:fs")).readdirSync(uploads).length;
  assert.equal(after, before, "no folder is left for a refused upload");
});

test("an empty file is refused and leaves nothing behind", async () => {
  const before = (await import("node:fs")).readdirSync(uploads).length;
  const res = await upload("empty.txt", "");
  assert.equal(res.status, 400);
  assert.equal((await import("node:fs")).readdirSync(uploads).length, before);
});

test("old uploads are swept when the next one arrives", async () => {
  const fs = await import("node:fs");
  const old = await (await upload("old.txt", "old")).json() as { path: string };
  const dir = join(old.path, "..");
  const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  utimesSync(dir, longAgo, longAgo);
  await upload("new.txt", "new");
  assert.equal(fs.existsSync(dir), false);
});

test("without a staging folder the endpoint is off", async () => {
  const off = createBridgeServer({ hub: createHub({ keepAliveMs: 60_000 }), token: TOKEN, send: () => true, status: () => ({ state: "running", pid: 1 }) });
  const { port } = await off.listen(0);
  const res = await fetch(`http://127.0.0.1:${port}/upload?name=a.txt`, { method: "POST", headers: auth, body: "x" });
  assert.equal(res.status, 404);
  await off.close();
});

// ---------- saved drafts ----------

const put = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/input`, { method: "PUT", headers: { ...auth, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const ID = "0f5d3c2a-1b4e-4f6a-9c7d-8e2b1a3c4d5e";
const good = { version: 1, chats: { "chat-1": { draft: "hello", held: [{ id: ID, text: "later", lost: 1 }] } } };

test("saved drafts need the token and the same origin", async () => {
  assert.equal((await fetch(`${base}/input`)).status, 401);
  assert.equal((await put(good, { origin: "http://evil.example" })).status, 403);
});

test("drafts are saved and read back, in an owner-only file", async () => {
  assert.equal((await put(good)).status, 204);
  const read = (await (await fetch(`${base}/input`, { headers: auth })).json()) as { saved: unknown };
  assert.deepEqual(read.saved, good);
  const file = join(inputDir, "chat-input.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), good);
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("only the exact shape is kept: extra fields, bad ids, long texts, repeats and too many entries are refused", async () => {
  const chat = (c: object) => ({ version: 1, chats: { a: { draft: "", held: [], ...c } } });
  const entry = (e: object = {}) => ({ id: ID, text: "t", lost: 0, ...e });
  for (const [name, body] of [
    ["unknown top field", { ...good, extra: 1 }],
    ["wrong version", { ...good, version: 2 }],
    ["bad chat id", { version: 1, chats: { "../x": { draft: "", held: [] } } }],
    ["extra chat field", chat({ files: ["/etc/passwd"] })],
    ["long draft", chat({ draft: "x".repeat(128 * 1024 + 1) })],
    ["bad entry id", chat({ held: [entry({ id: "nope" })] })],
    ["repeated entry id", chat({ held: [entry(), entry()] })],
    ["entry with a path", chat({ held: [{ ...entry(), path: "/x" }] })],
    ["bad file count", chat({ held: [entry({ lost: 9 })] })],
    ["21 entries", chat({ held: Array.from({ length: 21 }, (_, i) => entry({ id: `0f5d3c2a-1b4e-4f6a-9c7d-8e2b1a3c4d${String(i).padStart(2, "0")}` })) })],
  ] as const) {
    assert.equal((await put(body)).status, 400, name);
  }
  assert.equal((await put("not json")).status, 400);
  assert.deepEqual(((await (await fetch(`${base}/input`, { headers: auth })).json()) as { saved: unknown }).saved, good, "a refused save leaves the saved input as it was");
});

test("an unreadable saved file is set aside, not overwritten, and the window starts clean", async () => {
  const fs = await import("node:fs");
  fs.writeFileSync(join(inputDir, "chat-input.json"), "{ broken");
  const read = (await (await fetch(`${base}/input`, { headers: auth })).json()) as { saved: { chats: object }; note?: string };
  assert.deepEqual(read.saved.chats, {});
  assert.match(read.note!, /set aside/);
  assert.ok(fs.readdirSync(inputDir).some((n) => n.includes("unreadable")), "the original is kept");
});
