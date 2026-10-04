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

test("open_app refuses terminals and system settings, and unknown apps", async () => {
  const h = harness();
  await assert.rejects(() => Promise.resolve(h.run("open_app", { name: "Terminal" })), /never control/);
  await assert.rejects(() => Promise.resolve(h.run("open_app", { name: "System Settings" })), /never control/);
  await assert.rejects(() => Promise.resolve(h.run("open_app", { name: "Chrome" })), /no app called/);
  assert.ok(!h.calls.some((c) => c[0] === "/usr/bin/open"));
});

test("open_url opens web pages only", async () => {
  const h = harness();
  assert.equal(await h.run("open_url", { url: "youtube.com" }), "Opened youtube.com.");
  assert.deepEqual(h.calls.at(-1), ["/usr/bin/open", "https://youtube.com/"]);
  await assert.rejects(() => Promise.resolve(h.run("open_url", { url: "file:///etc/passwd" })), /only web pages/);
});
