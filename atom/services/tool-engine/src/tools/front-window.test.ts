import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanAddress, createFrontWindowTool, parseLsappinfo, readApp, type FrontApp } from "./front-window.ts";

const SEP = String.fromCharCode(31);
const signal = new AbortController().signal;

function setup(front: FrontApp | undefined, browser: string | Error = "") {
  const scripts: string[] = [];
  const reads: Array<{ bundleId?: string; fields: string[] }> = [];
  const tool = createFrontWindowTool({
    frontApp: async () => front,
    osascript: async (s) => {
      scripts.push(s);
      if (browser instanceof Error) throw browser;
      return browser;
    },
    onRead: (e) => reads.push(e),
  });
  return { run: () => tool.run({}, signal), scripts, reads };
}

test("cleanAddress keeps scheme, host and path only", () => {
  assert.equal(cleanAddress("https://user:pw@example.com/a/b?token=secret#top"), "https://example.com/a/b");
  assert.equal(cleanAddress("http://example.com"), "http://example.com/");
  assert.equal(cleanAddress("file:///Users/k/secret.pdf"), "a local page");
  assert.equal(cleanAddress("chrome://settings"), "a local page");
  assert.equal(cleanAddress("not a url"), "a local page");
});

test("parseLsappinfo reads the name and bundle id", () => {
  const out = `"Brave Browser" ASN:0x0-0x1:  (in front) \n    bundleID="com.brave.Browser"\n    bundle path=[ NULL ] `;
  assert.deepEqual(parseLsappinfo(out), { name: "Brave Browser", bundleId: "com.brave.Browser" });
  assert.equal(parseLsappinfo(""), undefined);
  assert.deepEqual(parseLsappinfo(`"Mystery" ASN:0x0-0x2:\n    bundleID=[ NULL ]`), { name: "Mystery" });
});

test("a supported browser gives the tab title and the cleaned address", async () => {
  const t = setup({ name: "Brave Browser", bundleId: "com.brave.Browser" }, `normal${SEP}Cats - Wikipedia${SEP}https://en.wikipedia.org/wiki/Cat?x=1#h`);
  const out = await t.run();
  assert.match(out, /Front app: Brave Browser/);
  assert.match(out, /Tab title: Cats - Wikipedia/);
  assert.match(out, /Address: https:\/\/en\.wikipedia\.org\/wiki\/Cat$/m);
  assert.match(out, /not instructions/);
  assert.equal(t.scripts.length, 1);
  assert.match(t.scripts[0]!, /application id "com\.brave\.Browser"/);
  assert.deepEqual(t.reads, [{ bundleId: "com.brave.Browser", fields: ["app", "title", "address"] }]);
});

test("a private window gives no title or address", async () => {
  const t = setup({ name: "Google Chrome", bundleId: "com.google.Chrome" }, `incognito${SEP}Secret${SEP}https://secret.example/`);
  const out = await t.run();
  assert.match(out, /private window/);
  assert.doesNotMatch(out, /Secret|secret\.example/);
  assert.deepEqual(t.reads[0]!.fields, ["app"]);
});

test("Safari, Firefox and other apps give the name only and run no script", async () => {
  for (const front of [
    { name: "Safari", bundleId: "com.apple.Safari" },
    { name: "Firefox", bundleId: "org.mozilla.firefox" },
    { name: "Notes", bundleId: "com.apple.Notes" },
  ]) {
    const t = setup(front, `normal${SEP}x${SEP}https://x.example/`);
    const out = await t.run();
    assert.match(out, new RegExp(`Front app: ${front.name}`));
    assert.doesNotMatch(out, /Tab title|Address/);
    assert.equal(t.scripts.length, 0, front.name);
  }
});

test("blocked apps are not read", async () => {
  for (const front of [{ name: "Terminal", bundleId: "com.apple.Terminal" }, { name: "Odd", bundleId: undefined }]) {
    const t = setup(front);
    const out = await t.run();
    assert.equal(out, `ATOM does not read ${front.name}.`);
    assert.equal(t.scripts.length, 0);
    assert.deepEqual(t.reads[0]!.fields, []);
  }
});

test("long titles are cut to 200 characters", async () => {
  const t = setup({ name: "Brave Browser", bundleId: "com.brave.Browser" }, `normal${SEP}${"a".repeat(500)}${SEP}https://x.example/`);
  const title = (await t.run()).split("\n").find((l) => l.startsWith("Tab title: "))!;
  assert.equal(title.length, "Tab title: ".length + 200);
});

test("a browser error gives the name and the reason, not a crash", async () => {
  const t = setup({ name: "Arc", bundleId: "company.thebrowser.Browser" }, new Error("Not authorized to send Apple events to Arc."));
  const out = await t.run();
  assert.match(out, /Front app: Arc/);
  assert.match(out, /could not read the tab: Not authorized/);
  assert.deepEqual(t.reads[0]!.fields, ["app"]);
});

test("a browser with no window gives the name only", async () => {
  const t = setup({ name: "Brave Browser", bundleId: "com.brave.Browser" }, "");
  assert.match(await t.run(), /no window open/);
});

test("no front app is an error", async () => {
  await assert.rejects(async () => setup(undefined).run(), /could not tell which app is in front/);
});

test("readApp reads the app it is given: a blocked app is not read", async () => {
  let scripts = 0;
  const read = await readApp({ name: "Terminal", bundleId: "com.apple.Terminal" }, { osascript: async () => (scripts++, "") });
  assert.deepEqual(read, { text: "ATOM does not read Terminal.", fields: [], blocked: true });
  assert.equal(scripts, 0);
});

test("readApp gives a browser's tab title and address", async () => {
  const read = await readApp(
    { name: "Brave Browser", bundleId: "com.brave.Browser" },
    { osascript: async () => `normal${SEP}Cats${SEP}https://cats.example/a?k=1` },
  );
  assert.equal(read.blocked, false);
  assert.deepEqual(read.fields, ["app", "title", "address"]);
  assert.match(read.text, /Front app: Brave Browser\nTab title: Cats\nAddress: https:\/\/cats\.example\/a\n/);
});

test("readApp gives only the name of a non-browser app", async () => {
  const read = await readApp({ name: "Notes", bundleId: "com.apple.Notes" }, { osascript: async () => assert.fail("no script") });
  assert.deepEqual(read, { text: "Front app: Notes\nOnly the app's name is available here.", fields: ["app"], blocked: false });
});
