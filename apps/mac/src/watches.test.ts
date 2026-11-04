import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWatchInput, createWatchRunner, createWatchStore, createWatchTool, dueWatches, judge, MAX_FAILURES, MAX_WATCHES, type Watch } from "./watches.ts";

const now = new Date("2026-11-04T10:00:00Z");
const make = (over: Record<string, unknown> = {}) => checkWatchInput({ url: "https://example.com/slots", mode: "contains", text: "slots open", everyMinutes: 30, ...over }, [], now);

test("a watch needs a public https page, a phrase for contains and missing, and 5 to 1440 minutes", () => {
  assert.equal(make().state, "watching");
  assert.throws(() => make({ url: "http://example.com/" }), /https/);
  assert.throws(() => make({ url: "https://localhost/x" }));
  assert.throws(() => make({ url: "https://192.168.1.1/admin" }));
  assert.throws(() => make({ url: "https://user:pw@example.com/" }));
  assert.throws(() => make({ url: "https://example.com:8443/" }), /standard port/);
  assert.throws(() => make({ text: "" }), /phrase/);
  assert.throws(() => make({ mode: "sometimes" }), /mode/);
  assert.throws(() => make({ everyMinutes: 1 }), /5 to 1440/);
  assert.equal(checkWatchInput({ url: "https://example.com/" }, [], now).mode, "change", "change is the default and needs no phrase");
});

test("at most ten pages are watched at once", () => {
  const full = Array.from({ length: MAX_WATCHES }, () => make());
  assert.throws(() => checkWatchInput({ url: "https://example.com/" }, full, now), /at most 10/);
});

test("judge: change fires on a different page after a baseline; contains and missing fire on the phrase", () => {
  const change = make({ mode: "change", text: undefined });
  const first = judge(change, "Hello   world");
  assert.equal(first.fired, false);
  const based = { ...change, baseline: first.baseline };
  assert.equal(judge(based, "hello world").fired, false, "case and spacing are not a change");
  assert.equal(judge(based, "Hello there").fired, true);
  assert.equal(judge(make(), "No Slots here").fired, false);
  assert.match(judge(make(), "Good news: Slots   OPEN today").message!, /"slots open" now appears on example.com/);
  assert.match(judge(make({ mode: "missing" }), "nothing").message!, /is gone from example.com/);
  assert.equal(judge(make({ mode: "missing" }), "slots open").fired, false);
});

test("due watches wait their interval and a fired or stopped watch is never read again", () => {
  const w = make();
  assert.equal(dueWatches([w], now).length, 1);
  assert.equal(dueWatches([{ ...w, lastCheckAt: "2026-11-04T09:45:00Z" }], now).length, 0);
  assert.equal(dueWatches([{ ...w, lastCheckAt: "2026-11-04T09:29:00Z" }], now).length, 1);
  assert.equal(dueWatches([{ ...w, state: "fired" }, { ...w, state: "stopped" }], now).length, 0);
});

test("the runner tells the user once, then stops reading; it stops a page that keeps failing", async () => {
  const store = createWatchStore();
  store.add(make());
  const events: unknown[] = [];
  let page = "nothing yet";
  const runner = createWatchRunner({ store, read: async () => page, notify: (e) => events.push(e) });
  assert.equal(await runner.tick(now), 1);
  assert.deepEqual(events, []);
  assert.equal(await runner.tick(new Date(now.getTime() + 10 * 60_000)), 0, "not due yet");
  page = "slots open now";
  assert.equal(await runner.tick(new Date(now.getTime() + 31 * 60_000)), 1);
  assert.equal(events.length, 1);
  assert.equal(store.list()[0]!.state, "fired");
  assert.equal(await runner.tick(new Date(now.getTime() + 120 * 60_000)), 0, "a watch fires once");

  const bad = createWatchStore();
  bad.add(make());
  const stopped: unknown[] = [];
  const failing = createWatchRunner({ store: bad, read: async () => { throw new Error("The page returned HTTP 503."); }, notify: (e) => stopped.push(e) });
  for (let i = 0; i < MAX_FAILURES; i++) await failing.tick(new Date(now.getTime() + i * 31 * 60_000));
  assert.equal(bad.list()[0]!.state, "stopped");
  assert.equal(stopped.length, 1);
  assert.match((stopped[0] as { message: string }).message, /stopped watching example.com: The page returned HTTP 503/);
});

test("the store keeps watches in a private file between runs", () => {
  const path = join(mkdtempSync(join(tmpdir(), "ark-watch-")), "watches.json");
  const store = createWatchStore(path);
  const w = store.add(make())[0]!;
  assert.equal(createWatchStore(path).list()[0]!.id, w.id);
  store.remove(w.id);
  assert.deepEqual(createWatchStore(path).list(), []);
});

test("the watch tool asks the user before it sets anything up; list and remove work by id", async () => {
  const store = createWatchStore();
  let asked: { summary: string; reason: string } | undefined;
  let answer = false;
  const tool = createWatchTool({ store, approve: async (r) => { asked = r; return answer; } });
  const refused = await tool.run({ action: "create", url: "https://example.com/slots", mode: "contains", text: "slots open" });
  assert.match(refused, /did not approve/);
  assert.deepEqual(store.list(), []);
  assert.match(asked!.summary, /example.com until it shows "slots open"/);
  assert.match(asked!.reason, /https:\/\/example.com\/slots every 30 minutes/);
  answer = true;
  assert.match(await tool.run({ action: "create", url: "https://example.com/slots", mode: "contains", text: "slots open" }), /now watches example.com/);
  const id = store.list()[0]!.id;
  assert.match(await tool.run({ action: "list" }), new RegExp(`${id}: watching`));
  assert.match(await tool.run({ action: "create", url: "http://example.com/" }), /not valid/);
  assert.match(await tool.run({ action: "remove", id: "nope" }), /No watch has the id/);
  assert.match(await tool.run({ action: "remove", id }), /removed/);
  assert.deepEqual(store.list(), []);
});

test("a watch holds a page's hash and the user's phrase, never page text", async () => {
  const store = createWatchStore();
  store.add(make({ mode: "change", text: undefined }));
  const runner = createWatchRunner({ store, read: async () => "SECRET PAGE TEXT", notify: () => {} });
  await runner.tick(now);
  const saved: Watch = store.list()[0]!;
  assert.doesNotMatch(JSON.stringify(saved), /SECRET/);
  assert.match(saved.baseline!, /^[0-9a-f]{32}$/);
});
