import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppTools, matchApp } from "./apps.ts";

const APPS = ["Safari", "Notes", "Music", "Terminal", "1Password 7", "Visual Studio Code", "System Settings"];

function harness() {
  const calls: string[][] = [];
  const ids: Record<string, string> = { Terminal: "com.apple.Terminal", Safari: "com.apple.Safari", "System Settings": "com.apple.systempreferences" };
  const tools = createAppTools({
    listApps: async () => APPS,
    exec: async (file, args) => {
      calls.push([file, ...args]);
      if (file.endsWith("osascript")) return `${ids[args[1]!.match(/"(.*)"/)![1]!] ?? ""}\n`;
      return "";
    },
  });
  const run = (name: string, input: Record<string, unknown>) => tools.find((t) => t.spec.name === name)!.run(input, new AbortController().signal);
  return { calls, run };
}

test("matchApp: exact, prefix, contains; nothing for unknown names", () => {
  assert.equal(matchApp("safari", APPS), "Safari");
  assert.equal(matchApp("Safari.app", APPS), "Safari");
  assert.equal(matchApp("vs code", APPS), undefined);
  assert.equal(matchApp("visual studio", APPS), "Visual Studio Code");
  assert.equal(matchApp("chrome", APPS), undefined);
});

test("open_app opens the matching app with open -a", async () => {
  const h = harness();
  assert.equal(await h.run("open_app", { name: "safari" }), "Opened Safari.");
  assert.deepEqual(h.calls.at(-1), ["/usr/bin/open", "-a", "Safari"]);
});

test("open_app refuses terminals and unknown apps", async () => {
  const h = harness();
  await assert.rejects(() => Promise.resolve(h.run("open_app", { name: "Terminal" })), /never control/);
  await assert.rejects(() => Promise.resolve(h.run("open_app", { name: "Chrome" })), /no app called/);
  assert.ok(!h.calls.some((c) => c[0] === "/usr/bin/open"));
});

test("open_app may open System Settings (open only: computer control still never touches it)", async () => {
  const h = harness();
  assert.equal(await h.run("open_app", { name: "System Settings" }), "Opened System Settings.");
  assert.deepEqual(h.calls.at(-1), ["/usr/bin/open", "-a", "System Settings"]);
});

test("open_url opens web pages only", async () => {
  const h = harness();
  assert.equal(await h.run("open_url", { url: "youtube.com" }), "Opened youtube.com.");
  assert.deepEqual(h.calls.at(-1), ["/usr/bin/open", "https://youtube.com/"]);
  await assert.rejects(() => Promise.resolve(h.run("open_url", { url: "file:///etc/passwd" })), /only web pages/);
});

function tabHarness(front: { name: string; bundleId?: string } | undefined, tab: string) {
  const opened: string[][] = [];
  const scripts: string[] = [];
  const tool = createAppTools({
    exec: async (file, args) => (opened.push([file, ...args]), ""),
    frontApp: async () => front,
    osascript: async (s) => (scripts.push(s), s.includes("set URL") ? "" : tab),
  }).find((t) => t.spec.name === "open_url")!;
  return { opened, scripts, run: (input: Record<string, unknown>) => tool.run(input, new AbortController().signal) };
}

const SEP = String.fromCharCode(31);
const BRAVE = { name: "Brave Browser", bundleId: "com.brave.Browser" };
const SEARCH = "https://www.youtube.com/results?search_query=cats";

test("open_url same_tab: loads it in the front Brave tab when that tab shows the same site", async () => {
  const h = tabHarness(BRAVE, `normal${SEP}YouTube${SEP}https://m.youtube.com/watch?v=1`);
  assert.equal(await h.run({ url: SEARCH, same_tab: true }), "Opened www.youtube.com in this tab.");
  assert.match(h.scripts.at(-1)!, /application id "com\.brave\.Browser" to set URL of active tab of front window to "https:\/\/www\.youtube\.com\/results\?search_query=cats"/);
  assert.equal(h.opened.length, 0);
});

test("open_url same_tab: a new tab for another site, a private window, another app, or a script error", async () => {
  for (const [front, tab] of [
    [BRAVE, `normal${SEP}News${SEP}https://bbc.co.uk/`],
    [BRAVE, `incognito${SEP}YouTube${SEP}https://www.youtube.com/`],
    [{ name: "Safari", bundleId: "com.apple.Safari" }, `normal${SEP}YouTube${SEP}https://www.youtube.com/`],
    [BRAVE, "not a reply"],
  ] as const) {
    const h = tabHarness(front, tab);
    assert.equal(await h.run({ url: SEARCH, same_tab: true }), "Opened www.youtube.com.");
    assert.deepEqual(h.opened, [["/usr/bin/open", SEARCH]]);
    assert.ok(!h.scripts.some((s) => s.includes("set URL")));
  }
});

test("open_url without same_tab never asks the browser", async () => {
  const h = tabHarness(BRAVE, `normal${SEP}YouTube${SEP}https://www.youtube.com/`);
  await h.run({ url: SEARCH });
  assert.equal(h.scripts.length, 0);
});

// 2026-10-16 (security review): open_url needs no approval, so the address itself must not be a way to send data out.
test("open_url refuses a login in the address and a long query or fragment, but opens ordinary search links", async () => {
  const h = harness();
  await assert.rejects(() => Promise.resolve(h.run("open_url", { url: "https://user:pass@example.com/" })), /login in it/);
  await assert.rejects(() => Promise.resolve(h.run("open_url", { url: `https://evil.test/?d=${"a".repeat(400)}` })), /carries \d+ characters of data/);
  await assert.rejects(() => Promise.resolve(h.run("open_url", { url: `https://evil.test/#${"b".repeat(400)}` })), /carries \d+ characters/);
  assert.equal(await h.run("open_url", { url: "https://www.google.com/search?q=pasta+recipes+for+two" }), "Opened www.google.com.");
  assert.equal(await h.run("open_url", { url: "http://localhost:3000" }), "Opened localhost.", "a local dev server is fine");
});

test("open_url refuses a very long address even when the query is short: the path and the host carry data too", async () => {
  const h = harness();
  await assert.rejects(() => Promise.resolve(h.run("open_url", { url: `https://evil.test/${"a".repeat(900)}` })), /characters long/);
  await assert.rejects(() => Promise.resolve(h.run("open_url", { url: `https://${"b".repeat(60)}.${"c".repeat(60)}.evil.test/${"d".repeat(800)}` })), /characters long/);
  assert.equal(await h.run("open_url", { url: "https://en.wikipedia.org/wiki/Glacier_National_Park_(U.S.)" }), "Opened en.wikipedia.org.");
});

