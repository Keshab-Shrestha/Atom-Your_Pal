import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BROWSER_SERVER, browserCheck, browserServer } from "./browser.ts";

// ADR-098 item 4: the browser policy (pure; no browser starts).

const root = mkdtempSync(join(tmpdir(), "zeno-browser-"));
after(() => rmSync(root, { recursive: true, force: true }));
const grant = join(root, "grant");
mkdirSync(grant);
writeFileSync(join(grant, "ok.txt"), "x");
writeFileSync(join(root, "secret.txt"), "x");
symlinkSync(join(root, "secret.txt"), join(grant, "link.txt"));

const T = (t: string) => `mcp__${BROWSER_SERVER}__browser_${t}`;
function policy(answer: (s: string) => boolean = () => true) {
  const asked: string[] = [];
  const events: any[] = [];
  const p = browserCheck({ name: "Scout", grants: [grant], approve: async (r) => (asked.push(r.summary), answer(r.summary)), onCheck: (e) => events.push(e) });
  return { ...p, asked, events };
}
const page = (url: string, extra = "") => `- Page URL: ${url}\n${extra}`;

test("browserServer: own Chromium, per-agent profile and output dirs inside data/", () => {
  const s = browserServer("/d", "scout") as any;
  assert.equal(s.type, "stdio");
  assert.ok(s.args.includes("--no-webmcp"));
  assert.equal(s.args[s.args.indexOf("--user-data-dir") + 1], "/d/browser-profile/scout");
  assert.equal(s.args[s.args.indexOf("--output-dir") + 1], "/d/browser-files/scout");
});

test("tools outside the list and foreign tool names are refused", async () => {
  const p = policy();
  for (const name of [T("evaluate"), T("run_code"), T("network_requests"), T(""), "Bash", "mcp__other__browser_click"]) {
    assert.ok("deny" in (await p.check(name, {})), name);
  }
  assert.deepEqual(p.asked, []);
});

test("navigate: http(s) only, one question per site, decline denies", async () => {
  const p = policy((s) => !s.includes("evil.test"));
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "chrome://settings", "not a url", ""]) {
    assert.ok("deny" in (await p.check(T("navigate"), { url })), url);
  }
  assert.ok("step" in (await p.check(T("navigate"), { url: "https://a.test/x" })));
  assert.ok("step" in (await p.check(T("navigate"), { url: "https://a.test/y" })));
  assert.deepEqual(p.asked.length, 1);
  assert.ok("deny" in (await p.check(T("navigate"), { url: "https://evil.test" })));
  assert.ok("step" in (await p.check(T("navigate"), { url: "about:blank" })));
  assert.ok("deny" in (await p.check(T("tabs"), { url: "ftp://x" })));
  assert.ok(p.events.some((e) => e.verdict === "declined" && e.origin === "https://evil.test"));
});

test("typing and form submits ask once per site; a declined page denies", async () => {
  const p = policy((s) => !s.includes("type or submit"));
  await p.check(T("navigate"), { url: "https://shop.test" });
  p.seen(page("https://shop.test/cart", "- button [ref=e5] Place order\n- link [ref=e6] About"));
  assert.ok("step" in (await p.check(T("snapshot"), {})));
  assert.ok("step" in (await p.check(T("click"), { target: "e6" })));
  assert.ok("deny" in (await p.check(T("type"), { target: "e1", text: "pw" })));
  assert.ok("deny" in (await p.check(T("click"), { target: "e5" })));
  assert.ok("deny" in (await p.check(T("press_key"), { key: "Enter" })));
  assert.ok("step" in (await p.check(T("press_key"), { key: "ArrowDown" })));
  assert.equal(p.asked.filter((a) => a.includes("type or submit")).length, 1);
});

test("a redirect to a new site is asked about before the page is acted on", async () => {
  const p = policy((s) => !s.includes("other.test"));
  await p.check(T("navigate"), { url: "https://a.test" });
  p.seen(page("https://other.test/landing"));
  const r = await p.check(T("click"), { target: "e1" });
  assert.ok("deny" in r && r.deny.includes("https://other.test"));
});

test("an output filename is refused (nothing saved outside data/)", async () => {
  const p = policy();
  assert.ok("deny" in (await p.check(T("take_screenshot"), { filename: "/tmp/x.png" })));
});

test("uploads only from granted folders, symlinks out of the grant included", async () => {
  const p = policy();
  await p.check(T("navigate"), { url: "https://a.test" });
  p.seen(page("https://a.test"));
  assert.ok("step" in (await p.check(T("file_upload"), { paths: [join(grant, "ok.txt")] })));
  for (const paths of [[join(root, "secret.txt")], [join(grant, "..", "secret.txt")], [join(grant, "link.txt")], [join(grant, "ok.txt"), "/etc/passwd"], [5]]) {
    assert.ok("deny" in (await p.check(T("file_upload"), { paths })), JSON.stringify(paths));
  }
  assert.ok("deny" in (await p.check(T("drop"), { paths: ["/etc/passwd"] })));
});
