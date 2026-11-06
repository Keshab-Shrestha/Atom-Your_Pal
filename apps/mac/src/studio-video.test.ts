import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSrt, estimateUsd, makeVideo, type MakeVideoInput, type StudioVideoDeps } from "./studio-video.ts";

const FFMPEG = "/opt/homebrew/bin/ffmpeg";
const FFPROBE = "/opt/homebrew/bin/ffprobe";
const hasFfmpeg = existsSync(FFMPEG) && existsSync(FFPROBE);
const KEY = "test-key";
const FILES = "https://generativelanguage.googleapis.com/v1beta/files";

const input: MakeVideoInput = { title: "Cats: a short test!", script: "Hello there. This is a test! Done?", scenes: [{ prompt: "a cat" }, { prompt: "a dog" }] };

function sine(seconds: number, sampleRate = 24_000) {
  const samples = new Float32Array(seconds * sampleRate);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  return { samples, sampleRate };
}

function deps(outDir: string, fetch: typeof globalThis.fetch, extra: Partial<StudioVideoDeps> = {}): StudioVideoDeps {
  return { apiKey: KEY, fetch, ffmpeg: FFMPEG, ffprobe: FFPROBE, outDir, synthesize: async () => sine(3), pollMs: 1, sleep: async () => {}, ...extra };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const video = (part: Record<string, string>) => json({ id: "i1", status: "completed", object: "interaction", steps: [{ type: "user_input", content: [{ type: "text" }] }, { type: "model_output", content: [{ type: "video", mime_type: "video/mp4", ...part }] }] });
const noFetch = (() => { throw new Error("fetch must not be called"); }) as unknown as typeof fetch;

test("validation rejects bad input with plain reasons and never calls the API", async () => {
  const out = mkdtempSync(join(tmpdir(), "studio-"));
  const bad: [Partial<MakeVideoInput>, RegExp][] = [
    [{ title: "" }, /title/],
    [{ title: "x".repeat(101) }, /title/],
    [{ script: "" }, /script/],
    [{ script: "x".repeat(1201) }, /script/],
    [{ scenes: [] }, /1 to 6 scenes/],
    [{ scenes: Array.from({ length: 7 }, () => ({ prompt: "a" })) }, /1 to 6 scenes/],
    [{ scenes: [{ prompt: "x".repeat(601) }] }, /Scene 1/],
    [{ secondsPerScene: 2 }, /whole number from 3 to 15/],
    [{ secondsPerScene: 4.5 }, /whole number/],
    [{ scenes: Array.from({ length: 6 }, () => ({ prompt: "a" })), secondsPerScene: 15 }, /most is 60 s/],
    [{ script: "word ".repeat(160) }, /Shorten it/],
    [{ quality: "ultra" as never }, /Quality/],
  ];
  for (const [patch, reason] of bad) {
    await assert.rejects(makeVideo({ ...input, ...patch }, deps(out, noFetch)), reason);
  }
  assert.deepEqual(readdirSync(out), []);
});

test("estimateUsd prices seconds per tier, defaulting to footage that covers the voice", () => {
  assert.equal(estimateUsd({ ...input, secondsPerScene: 4 }, "gemini-omni-1.2-flash"), 0.18); // 8 s * $0.023
  assert.equal(estimateUsd({ ...input, secondsPerScene: 10, quality: "standard" }, "veo"), 2.08); // unknown id → default table
  assert.equal(estimateUsd(input, "x"), 0.14); // 7 words ≈ 2.8 s + 0.5 → 3 s per scene (the minimum)
});

test("refuses over budget before any API call", async () => {
  const out = mkdtempSync(join(tmpdir(), "studio-"));
  await assert.rejects(makeVideo({ ...input, secondsPerScene: 15, quality: "standard" }, deps(out, noFetch, { maxUsd: 1 })), /above the \$1\.00 limit/);
  await assert.rejects(makeVideo(Object.assign({}, input, { scenes: Array.from({ length: 6 }, () => ({ prompt: "a" })), secondsPerScene: 10, quality: "standard" }), deps(out, noFetch)), /\$6\.24.*\$5\.00/);
});

test("buildSrt times one cue per sentence across the voice", () => {
  const srt = buildSrt("One. Two two! Three three three?", 3000);
  const cues = srt.trim().split("\n\n");
  assert.equal(cues.length, 3);
  assert.match(cues[0]!, /^1\n00:00:00,000 --> 00:00:00,\d{3}\nOne\.$/);
  assert.match(cues[2]!, /--> 00:00:03,000\nThree three three\?$/);
});

test("abort while polling stops and leaves no files", async () => {
  const out = mkdtempSync(join(tmpdir(), "studio-"));
  const controller = new AbortController();
  let polls = 0;
  const fetch = (async (url: string) => {
    if (url.endsWith("/interactions")) return video({ uri: `${FILES}/slow:download?alt=media` });
    polls++;
    return json({ state: "PROCESSING" });
  }) as typeof globalThis.fetch;
  const run = makeVideo(input, deps(out, fetch, { sleep: async () => { controller.abort(); } }), controller.signal);
  await assert.rejects(run, /stopped/);
  assert.ok(polls >= 1);
  assert.deepEqual(readdirSync(out), []);
});

test("makes a 1080x1920 Short with voice, clip audio and captions", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const src = mkdtempSync(join(tmpdir(), "studio-src-"));
  const out = join(mkdtempSync(join(tmpdir(), "studio-")), "Studio");
  const clip = join(src, "clip.mp4");
  execFileSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=30", "-f", "lavfi", "-i", "sine=frequency=220",
    "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);
  const bytes = readFileSync(clip);
  const calls: string[] = [];
  let states = 0;
  const fetch = (async (url: string, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>)["x-goog-api-key"], KEY);
    calls.push(`${init?.method ?? "GET"} ${url.replace(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta/, "")}`);
    if (url.endsWith("/interactions")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.response_format.aspect_ratio, "9:16");
      assert.equal(body.response_format.duration, "3s");
      // First clip arrives as a file URI (polled), the second inline.
      return calls.filter((c) => c.startsWith("POST")).length === 1
        ? video({ uri: `${FILES}/f1:download?alt=media` })
        : video({ data: bytes.toString("base64") });
    }
    if (url.endsWith("/files/f1")) return json({ state: states++ === 0 ? "PROCESSING" : "ACTIVE" });
    if (url.endsWith("/files/f1:download?alt=media")) return new Response(bytes);
    throw new Error(`unexpected ${url}`);
  }) as typeof globalThis.fetch;

  const result = await makeVideo(input, deps(out, fetch));

  assert.equal(result.clips, 2);
  assert.equal(result.model, "gemini-omni-1.2-flash");
  assert.equal(result.estimatedUsd, 0.14);
  assert.match(result.file, /Studio\/cats-a-short-test-\d{8}-\d{6}\.mp4$/);
  assert.ok(existsSync(result.file));
  assert.deepEqual(readdirSync(out).sort(), [result.file, result.srt].map((f) => f.split("/").pop()).sort()); // work folder gone
  const probe = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", result.file], { encoding: "utf8" }));
  const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  assert.equal(v.width, 1080);
  assert.equal(v.height, 1920);
  assert.equal(v.codec_name, "h264");
  assert.ok(probe.streams.some((s: { codec_type: string; codec_name: string }) => s.codec_type === "audio" && s.codec_name === "aac"));
  assert.ok(Math.abs(Number(probe.format.duration) - 3.5) < 0.15, `duration ${probe.format.duration}`);
  assert.ok(Math.abs(result.durationMs - 3500) < 150);
  assert.equal(readFileSync(result.srt, "utf8").trim().split("\n\n").length, 3);
});
