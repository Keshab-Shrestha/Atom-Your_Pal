import { test } from "node:test";
import assert from "node:assert/strict";
import { HUB_FETCHES_PER_MINUTE, HUB_FILE_BYTES, HubError, createHubClient } from "./skill-hub.ts";

// B3.5, ADR-102: the hub's network door. No real network: fetchImpl is a stub.

const SHA = "c".repeat(40);
const SHA2 = "d".repeat(40);
const TEXT = { "content-type": "text/plain; charset=utf-8" };
const JSON_H = { "content-type": "application/json; charset=utf-8" };
const skill = (description: string) => `---\nname: x\ndescription: ${description}\n---\n\nSteps.\n`;
const tree = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    truncated: false,
    tree: ["skills/pdf/SKILL.md", "skills/pdf/scripts/run.py", "skills/pdf-forms/SKILL.md", "template/SKILL.md", "README.md", "skills/Bad_Name/SKILL.md", "skills/deep/er/SKILL.md"].map((path) => ({ path, type: "blob" })),
    ...extra,
  });

interface Call {
  url: string;
  init: RequestInit;
}

/** A stub GitHub: answers by URL; `over` replaces an answer. */
function github(over: Record<string, () => Response> = {}, head = SHA) {
  const calls: Call[] = [];
  const answers: Record<string, () => Response> = {
    [`https://api.github.com/repos/anthropics/skills/commits/HEAD`]: () => new Response(JSON.stringify({ sha: head }), { headers: JSON_H }),
    [`https://api.github.com/repos/anthropics/skills/git/trees/${head}?recursive=1`]: () => new Response(tree(), { headers: JSON_H }),
    [`https://raw.githubusercontent.com/anthropics/skills/${head}/skills/pdf/SKILL.md`]: () => new Response(skill("Read PDFs."), { headers: TEXT }),
    [`https://raw.githubusercontent.com/anthropics/skills/${head}/skills/pdf-forms/SKILL.md`]: () => new Response(skill("Fill forms."), { headers: TEXT }),
    ...over,
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const answer = answers[String(url)];
    if (!answer) return new Response("nope", { status: 404, headers: TEXT });
    return answer();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("search: one commit lookup, one tree, matches by folder name (exact first), descriptions from front matter", async () => {
  const { calls, fetchImpl } = github();
  const hub = createHubClient({ fetchImpl });
  const hits = await hub.searchHub("PDF");
  assert.deepEqual(hits.map((h) => [h.name, h.description, h.path, h.sha, h.source, h.repo]), [
    ["pdf", "Read PDFs.", "skills/pdf/SKILL.md", SHA, 0, "anthropics/skills"],
    ["pdf-forms", "Fill forms.", "skills/pdf-forms/SKILL.md", SHA, 0, "anthropics/skills"],
  ]);
  assert.equal(calls.filter((c) => c.url.includes("/commits/")).length, 1);
  assert.equal(calls.filter((c) => c.url.includes("/git/trees/")).length, 1);
  assert.ok(calls.every((c) => c.init.redirect === "error" && c.init.signal instanceof AbortSignal), "no redirects, always a time limit");
  assert.ok(calls.every((c) => ["api.github.com", "raw.githubusercontent.com"].includes(new URL(c.url).hostname) && c.url.startsWith("https://")));
  assert.ok(calls.every((c) => !("authorization" in ((c.init.headers ?? {}) as object))), "no account, no token");
  const before = calls.length;
  await hub.searchHub("forms");
  assert.equal(calls.filter((c) => c.url.includes("/git/trees/")).length, 1, "the tree is kept for 10 minutes");
  assert.equal(calls.length, before + 1);
});

test("search keeps only skills/<name>/SKILL.md or <name>/SKILL.md with a valid name, and at most 10 hits", async () => {
  const many = JSON.stringify({ tree: Array.from({ length: 15 }, (_, i) => ({ path: `skills/tool-${String(i).padStart(2, "0")}/SKILL.md`, type: "blob" })).concat([{ path: "template/SKILL.md", type: "blob" }, { path: "skills/Bad_Name/SKILL.md", type: "blob" }, { path: "skills/deep/er/SKILL.md", type: "blob" }]) });
  const { fetchImpl } = github({ [`https://api.github.com/repos/anthropics/skills/git/trees/${SHA}?recursive=1`]: () => new Response(many, { headers: JSON_H }) });
  const hub = createHubClient({ fetchImpl });
  assert.equal((await hub.searchHub("tool")).length, 10);
  assert.deepEqual((await hub.searchHub("templ")).map((h) => h.name), ["template"]);
  assert.deepEqual(await hub.searchHub("bad_"), []);
  assert.deepEqual(await hub.searchHub("er"), []);
});

test("search refuses an empty or over-long query; the cache expires after 10 minutes", async () => {
  let clock = 0;
  const { calls, fetchImpl } = github();
  const hub = createHubClient({ fetchImpl, now: () => clock });
  await assert.rejects(hub.searchHub("   "), /1 to 60/);
  await assert.rejects(hub.searchHub("x".repeat(61)), /1 to 60/);
  await hub.searchHub("pdf");
  clock += 11 * 60_000;
  await hub.searchHub("pdf");
  assert.equal(calls.filter((c) => c.url.includes("/git/trees/")).length, 2);
});

test("a truncated tree is a plain message", async () => {
  const { fetchImpl } = github({ [`https://api.github.com/repos/anthropics/skills/git/trees/${SHA}?recursive=1`]: () => new Response(tree({ truncated: true }), { headers: JSON_H }) });
  await assert.rejects(createHubClient({ fetchImpl }).searchHub("pdf"), (e) => e instanceof HubError && /too big for ZENO to search/.test(e.message));
});

test("the host allowlist: other hosts, http and a user name are refused before any request", async () => {
  const { calls, fetchImpl } = github();
  const hub = createHubClient({ fetchImpl });
  for (const url of ["https://evil.example/a", "http://api.github.com/a", "https://api.github.com.evil.example/a", "https://user:pw@api.github.com/a", "https://github.com/a", "file:///etc/passwd"]) {
    await assert.rejects(hub.read(url, 1000), HubError, url);
  }
  assert.equal(calls.length, 0);
});

test("a redirect is refused (redirect: error, and a 3xx answer)", async () => {
  const { calls, fetchImpl } = github({ "https://raw.githubusercontent.com/a/b": () => new Response(null, { status: 302, headers: { location: "https://evil.example" } }) });
  await assert.rejects(createHubClient({ fetchImpl }).read("https://raw.githubusercontent.com/a/b", 1000), /redirected/);
  assert.equal(calls[0]!.init.redirect, "error");
  const thrower = (async () => { throw new TypeError("redirect mode is set to error"); }) as unknown as typeof fetch;
  await assert.rejects(createHubClient({ fetchImpl: thrower }).read("https://raw.githubusercontent.com/a/b", 1000), HubError);
});

test("a file over 64 KB is refused, streamed (no content-length) or declared", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 20; i += 1) controller.enqueue(new Uint8Array(HUB_FILE_BYTES / 10));
      controller.close();
    },
  });
  const url = "https://raw.githubusercontent.com/a/b";
  const streamed = createHubClient({ fetchImpl: (async () => new Response(stream, { headers: TEXT })) as unknown as typeof fetch });
  await assert.rejects(streamed.read(url, HUB_FILE_BYTES), /too big/);
  const declared = createHubClient({ fetchImpl: (async () => new Response("x", { headers: { ...TEXT, "content-length": String(HUB_FILE_BYTES + 1) } })) as unknown as typeof fetch });
  await assert.rejects(declared.read(url, HUB_FILE_BYTES), /too big/);
  const exact = createHubClient({ fetchImpl: (async () => new Response("y".repeat(HUB_FILE_BYTES), { headers: TEXT })) as unknown as typeof fetch });
  assert.equal((await exact.read(url, HUB_FILE_BYTES)).length, HUB_FILE_BYTES);
});

test("a slow answer is cut off after the time limit", async () => {
  const hangs = ((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
  await assert.rejects(createHubClient({ fetchImpl: hangs, timeoutMs: 20 }).read("https://raw.githubusercontent.com/a/b", 1000), /did not answer in time/);
});

test("an answer that is not UTF-8 text, or not text at all, is refused", async () => {
  const url = "https://raw.githubusercontent.com/a/b";
  const bad = createHubClient({ fetchImpl: (async () => new Response(new Uint8Array([0x41, 0xff, 0xfe]), { headers: TEXT })) as unknown as typeof fetch });
  await assert.rejects(bad.read(url, 1000), /not valid UTF-8/);
  const png = createHubClient({ fetchImpl: (async () => new Response("x", { headers: { "content-type": "image/png" } })) as unknown as typeof fetch });
  await assert.rejects(png.read(url, 1000), /not text/);
});

test("GitHub's limit for requests without an account is a plain message", async () => {
  const url = "https://raw.githubusercontent.com/a/b";
  for (const res of [() => new Response("", { status: 429, headers: TEXT }), () => new Response("", { status: 403, headers: { ...TEXT, "x-ratelimit-remaining": "0" } })]) {
    await assert.rejects(createHubClient({ fetchImpl: (async () => res()) as unknown as typeof fetch }).read(url, 1000), /limit for requests without an account/);
  }
  await assert.rejects(createHubClient({ fetchImpl: (async () => new Response("", { status: 500, headers: TEXT })) as unknown as typeof fetch }).read(url, 1000), /error \(500\)/);
});

test("at most 20 requests a minute", async () => {
  let clock = 0;
  let n = 0;
  const hub = createHubClient({ fetchImpl: (async () => (n += 1, new Response("ok", { headers: TEXT }))) as unknown as typeof fetch, now: () => clock });
  for (let i = 0; i < HUB_FETCHES_PER_MINUTE; i += 1) await hub.read("https://raw.githubusercontent.com/a/b", 100);
  await assert.rejects(hub.read("https://raw.githubusercontent.com/a/b", 100), /many requests/);
  assert.equal(n, HUB_FETCHES_PER_MINUTE);
  clock += 60_000;
  await hub.read("https://raw.githubusercontent.com/a/b", 100);
  assert.equal(n, HUB_FETCHES_PER_MINUTE + 1);
});

test("fetchSkill reads exactly one SKILL.md at the pinned sha; a fresh look re-resolves the newest commit", async () => {
  const { calls, fetchImpl } = github({
    [`https://api.github.com/repos/anthropics/skills/commits/HEAD`]: () => new Response(JSON.stringify({ sha: SHA2 }), { headers: JSON_H }),
    [`https://raw.githubusercontent.com/anthropics/skills/${SHA2}/skills/pdf/SKILL.md`]: () => new Response(skill("Newer."), { headers: TEXT }),
  }, SHA2);
  const hub = createHubClient({ fetchImpl });
  const file = await hub.fetchSkill(0, "skills/pdf/SKILL.md");
  assert.deepEqual([file.repo, file.path, file.sha, file.text.includes("Newer.")], ["anthropics/skills", "skills/pdf/SKILL.md", SHA2, true]);
  assert.equal(calls.filter((c) => c.url.startsWith("https://raw.")).length, 1);
  assert.ok(calls.every((c) => !c.url.includes("scripts")));
  await hub.fetchSkill(0, "skills/pdf/SKILL.md", true);
  assert.equal(calls.filter((c) => c.url.includes("/commits/")).length, 2);
});

test("fetchSkill refuses a bad source, a traversal path, a backslash, another file name and a bad folder name", async () => {
  const { calls, fetchImpl } = github();
  const hub = createHubClient({ fetchImpl });
  await assert.rejects(hub.fetchSkill(5, "skills/pdf/SKILL.md"), /not in ZENO's list/);
  await assert.rejects(hub.fetchSkill(-1, "skills/pdf/SKILL.md"), /not in ZENO's list/);
  for (const path of ["../x/SKILL.md", "skills/../SKILL.md", "skills\\pdf/SKILL.md", "skills/pdf/scripts/run.py", "skills/pdf/OTHER.md", "skills/Bad_Name/SKILL.md", "/skills/pdf/SKILL.md", "skills/p/SKILL.md"]) {
    await assert.rejects(hub.fetchSkill(0, path), /not a skill ZENO can take/, path);
  }
  assert.equal(calls.length, 0);
});
