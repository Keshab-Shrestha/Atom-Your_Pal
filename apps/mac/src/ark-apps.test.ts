import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASKS_PER_MINUTE, MAX_APPS, MAX_KEYS, checkAppInput, createAppStore, createAppTool, createBridge } from "./ark-apps.ts";

const page = (body = "<button id=b>Go</button><script>document.getElementById('b').onclick=async()=>{await ark.storage.set('n','1')}</script>") => `<!doctype html><html><body>${body}</body></html>`;
const input = (over: Record<string, unknown> = {}) => ({ name: "Habit tracker", description: "Tick a habit each day", html: page(), ...over });

test("an app is one inline page; anything that reaches outside it is refused with words", () => {
  assert.equal(checkAppInput(input()).permissions.ask, false);
  assert.equal(checkAppInput(input({ ask: true })).permissions.ask, true);
  for (const html of [
    page('<script src="https://cdn.example.com/x.js"></script>'),
    page('<img src="//evil.test/p.png">'),
    page('<link rel="stylesheet" href="https://fonts.example.com/a.css">'),
    page("<style>@import url(https://x.test/a.css);</style>"),
    page("<script>fetch('/x')</script>"),
    page("<script>new XMLHttpRequest()</script>"),
    page('<form action="https://x.test"></form>'),
    page('<meta http-equiv="refresh" content="0;url=https://x.test">'),
  ]) assert.throws(() => checkAppInput(input({ html })), /reaches outside itself/, html);
  assert.equal(checkAppInput(input({ html: page('<img src="data:image/png;base64,AAAA">') })).html.includes("data:image"), true, "data: images are inline");
  assert.throws(() => checkAppInput(input({ name: "" })), /name is required/);
  assert.throws(() => checkAppInput(input({ html: "x".repeat(200_001) })), /over 200 KB/);
  assert.throws(() => checkAppInput(input({ html: "" })), /whole page/);
  assert.throws(() => checkAppInput(input({ id: "../etc" })), /app id/);
});

test("the store makes a unique id, counts versions, keeps notes apart, and survives a restart", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ark-apps-")), "apps");
  const store = createAppStore(dir);
  const a = store.save(checkAppInput(input()));
  const b = store.save(checkAppInput(input()));
  assert.deepEqual([a.id, b.id], ["habit-tracker", "habit-tracker-2"]);
  store.storageSet(a.id, "streak", "7");
  assert.equal(store.storageGet(b.id, "streak"), undefined, "another app's notes are not visible");
  const v2 = store.save(checkAppInput(input({ id: a.id, html: page("v2") })));
  assert.equal(v2.version, 2);
  assert.equal(readFileSync(join(dir, a.id, "index.html"), "utf8").includes("v2"), true);
  const again = createAppStore(dir);
  assert.equal(again.list().length, 2);
  assert.equal(again.storageGet(a.id, "streak"), "7");
  assert.throws(() => store.save(checkAppInput(input({ id: "nope" }))), /No app has the id/);
  assert.equal(store.remove(a.id), true);
  assert.equal(existsSync(join(dir, a.id)), false);
  assert.equal(store.storageGet(a.id, "streak"), undefined);
});

test("the store caps apps, notes and note size", () => {
  const store = createAppStore();
  for (let i = 0; i < MAX_APPS; i++) store.save(checkAppInput(input({ name: `App ${i}` })));
  assert.throws(() => store.save(checkAppInput(input({ name: "One more" }))), /at most 30 apps/);
  const id = store.list()[0]!.id;
  for (let i = 0; i < MAX_KEYS; i++) store.storageSet(id, `k${i}`, "v");
  assert.throws(() => store.storageSet(id, "extra", "v"), /at most 64 notes/);
  assert.throws(() => store.storageSet(id, "k0", "x".repeat(16_001)), /16 KB/);
  assert.throws(() => store.storageSet(id, "", "v"), /key is 1 to 100/);
});

test("the bridge: notes work, ask needs the permission and a rate limit, unknown calls and removed apps are refused", async () => {
  const store = createAppStore();
  const quiet = store.save(checkAppInput(input()));
  const curious = store.save(checkAppInput(input({ name: "Curious", ask: true })));
  let clock = 0;
  const asks: string[] = [];
  const call = createBridge({ store, ask: async (p) => (asks.push(p), "ok"), now: () => clock });
  await call(quiet.id, "storage.set", { key: "a", value: "1" });
  assert.equal(await call(quiet.id, "storage.get", { key: "a" }), "1");
  assert.equal(await call(quiet.id, "storage.get", { key: "missing" }), null);
  assert.deepEqual(await call(quiet.id, "storage.list", {}), ["a"]);
  await call(quiet.id, "storage.remove", { key: "a" });
  assert.deepEqual(await call(quiet.id, "storage.list", {}), []);
  await assert.rejects(() => call(quiet.id, "ask", { prompt: "hi" }), /not allowed to ask/);
  await assert.rejects(() => call(quiet.id, "storage.set", { key: "a", value: 5 }), /string/);
  await assert.rejects(() => call(quiet.id, "shell.run", {}), /not something apps can do/);
  await assert.rejects(() => call("gone", "storage.list", {}), /removed/);
  for (let i = 0; i < ASKS_PER_MINUTE; i++) assert.equal(await call(curious.id, "ask", { prompt: `q${i}` }), "ok");
  await assert.rejects(() => call(curious.id, "ask", { prompt: "q" }), /6 times a minute/);
  clock = 61_000;
  assert.equal(await call(curious.id, "ask", { prompt: "later" }), "ok");
  await assert.rejects(() => call(curious.id, "ask", { prompt: "x".repeat(2001) }), /1 to 2000/);
});

test("the tool asks before it makes, changes or removes; list and read need no card", async () => {
  const store = createAppStore();
  const cards: Array<{ summary: string; reason: string }> = [];
  let yes = false;
  const tool = createAppTool({ store, approve: async (r) => (cards.push(r), yes) });
  assert.match(await tool.run({ action: "create", ...input() }), /did not approve/);
  assert.equal(store.list().length, 0);
  assert.match(cards[0]!.summary, /Add an app: Habit tracker/);
  assert.match(cards[0]!.reason, /cannot ask ARK anything/);
  assert.match(cards[0]!.reason, /no network and no files/);
  yes = true;
  assert.match(await tool.run({ action: "create", ...input({ ask: true }) }), /habit-tracker/);
  assert.match(cards[1]!.reason, /may ask ARK questions/);
  assert.match(await tool.run({ action: "list" }), /habit-tracker: Habit tracker \(v1\)/);
  assert.match(await tool.run({ action: "read", id: "habit-tracker" }), /<button id=b>/);
  assert.match(await tool.run({ action: "update", id: "habit-tracker", ...input({ html: page("v2") }) }), /habit-tracker/);
  assert.match(cards[2]!.summary, /Update an app/);
  assert.equal(store.get("habit-tracker")!.manifest.version, 2);
  assert.match(await tool.run({ action: "update", ...input() }), /needs the "id"/);
  assert.match(await tool.run({ action: "create", ...input({ html: page("<script src='https://x.test/a.js'></script>") }) }), /not valid.*reaches outside/);
  yes = false;
  assert.match(await tool.run({ action: "remove", id: "habit-tracker" }), /did not approve/);
  assert.equal(store.list().length, 1);
  yes = true;
  assert.match(await tool.run({ action: "remove", id: "habit-tracker" }), /removed/);
  assert.equal(store.list().length, 0);
  assert.match(await tool.run({ action: "remove", id: "habit-tracker" }), /No app has that id/);
});
