import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioTools, studioFile, MAKE_VIDEO_TOOL, PUBLISH_YOUTUBE_TOOL } from "./studio-tools.ts";

const noFetch = (async () => { throw new Error("no network in this test"); }) as unknown as typeof fetch;

test("only an existing .mp4 inside the Studio folder can be posted (ADR-267)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ark-studio-"));
  try {
    const out = join(dir, "studio");
    mkdirSync(out);
    writeFileSync(join(out, "a.mp4"), "x");
    writeFileSync(join(dir, "outside.mp4"), "x");
    assert.equal(studioFile(out, "a.mp4"), join(out, "a.mp4"));
    assert.throws(() => studioFile(out, join(dir, "outside.mp4")), /Studio folder/);
    assert.throws(() => studioFile(out, "../outside.mp4"), /Studio folder/);
    assert.throws(() => studioFile(out, "missing.mp4"), /not a video/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("making a video asks first with the cost; No spends nothing; no key explains what to add", async () => {
  const asked: string[] = [];
  const tools = createStudioTools({
    outDir: tmpdir(),
    video: { apiKey: "test", fetch: noFetch, ffmpeg: "/x", ffprobe: "/x", synthesize: async () => { throw new Error("must not run"); } },
    approve: async (r) => { asked.push(`${r.summary} | ${r.reason}`); return false; },
  });
  const make = tools.find((t) => t.spec.name === MAKE_VIDEO_TOOL)!;
  const said = await make.run({ title: "AI news", script: "Three things happened in AI today.", scenes: ["a robot at a desk"] });
  assert.match(String(said), /did not allow/);
  assert.equal(asked.length, 1);
  assert.match(asked[0]!, /Make a video: AI news .*Estimated cost: about \$\d+\.\d\d/);
  const bare = createStudioTools({ outDir: tmpdir(), approve: async () => true }).find((t) => t.spec.name === MAKE_VIDEO_TOOL)!;
  await assert.rejects(async () => bare.run({ title: "x", script: "y", scenes: ["z"] }), /ARK_STUDIO_GEMINI_KEY/);
});

test("posting needs YouTube set up and refuses files outside the Studio folder before asking", async () => {
  let asked = 0;
  const bare = createStudioTools({ outDir: tmpdir(), approve: async () => { asked += 1; return true; } }).find((t) => t.spec.name === PUBLISH_YOUTUBE_TOOL)!;
  await assert.rejects(async () => bare.run({ file: "a.mp4", title: "t", description: "d" }), /ARK_YOUTUBE_CLIENT_ID/);
  const tokens = { read: () => ({ refreshToken: "r" }), write: () => {}, clear: () => {} };
  const withYoutube = createStudioTools({ outDir: join(tmpdir(), "ark-none"), youtube: { client: { clientId: "i", clientSecret: "s" }, tokens, fetch: noFetch }, approve: async () => { asked += 1; return true; } })
    .find((t) => t.spec.name === PUBLISH_YOUTUBE_TOOL)!;
  await assert.rejects(async () => withYoutube.run({ file: "/etc/hosts.mp4", title: "t", description: "d" }), /Studio folder/);
  assert.equal(asked, 0, "nothing was asked or sent");
});

test("a link inside the Studio folder is never posted; an over-budget video is refused before any card (security review)", async () => {
  const { symlinkSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "ark-studio-"));
  try {
    const out = join(dir, "studio");
    mkdirSync(out);
    writeFileSync(join(dir, "secret.mp4"), "x");
    symlinkSync(join(dir, "secret.mp4"), join(out, "x.mp4"));
    assert.throws(() => studioFile(out, "x.mp4"), /Studio folder/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  let asked = 0;
  const make = createStudioTools({
    outDir: tmpdir(),
    video: { apiKey: "test", fetch: noFetch, ffmpeg: "/x", ffprobe: "/x", maxUsd: 0.01, synthesize: async () => { throw new Error("must not run"); } },
    approve: async () => { asked += 1; return true; },
  }).find((t) => t.spec.name === MAKE_VIDEO_TOOL)!;
  await assert.rejects(async () => make.run({ title: "x", script: "Some words for the voice.", scenes: ["a", "b"] }), /above the \$0\.01 limit/);
  assert.equal(asked, 0);
});
