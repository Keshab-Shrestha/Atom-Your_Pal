import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { toWav } from "./stt.ts";

/**
 * Studio video (ADR-267): a script and scene prompts become a vertical (9:16) MP4 Short.
 * Footage: Google's video model via the Gemini API (key in `x-goog-api-key`). Voice: ARK's TTS. Assembly: ffmpeg.
 *
 * Veo is NOT used: Google shut down Veo 3.1 Preview in the Gemini API on 2026-10-22 (veo-3.0 / veo-2.0 on 2026-06-30),
 * and names `gemini-omni-1.2-flash` as the replacement. GA Veo 3.1 lives only on the Gemini Enterprise Agent Platform
 * (project + OAuth, not an API key). Checked 2026-11-06:
 * - https://aistudio.google.com/docs/video (was ai.google.dev/gemini-api/docs/video)
 * - https://aistudio.google.com/docs/deprecations
 * - https://aistudio.google.com/docs/omni  (Interactions API: POST /v1beta/interactions, response_format, delivery "uri",
 *   GET /v1beta/files/{id} until state ACTIVE, GET /v1beta/files/{id}:download?alt=media)
 * - https://aistudio.google.com/docs/pricing#gemini-omni-1.2-flash
 * - https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate (GA Veo, not used here)
 */

export interface StudioScene { prompt: string } // what the clip shows; no on-screen text
export interface MakeVideoInput { title: string; script: string; scenes: StudioScene[]; secondsPerScene?: number; quality?: "lite" | "fast" | "standard" }
export interface MakeVideoResult { file: string; srt: string; durationMs: number; clips: number; estimatedUsd: number; model: string }
export interface StudioVideoDeps {
  apiKey: string;
  fetch: typeof fetch;
  ffmpeg: string; ffprobe: string; // absolute paths
  outDir: string; // a folder the result goes in (create if missing)
  synthesize(text: string): Promise<{ samples: Float32Array; sampleRate: number }>; // ARK's TTS
  model?: string;
  maxUsd?: number; // refuse before any API call if the estimate is above this (default 5)
  pollMs?: number; sleep?(ms: number): Promise<void>; // injectable for tests
  log?(event: string, fields: Record<string, unknown>): void; // ids, counts, ms only; never prompts or keys
}

const API = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-omni-1.2-flash";
const RESOLUTION = { lite: "360p", fast: "720p", standard: "1080p" } as const;
/**
 * USD per generated second, by resolution. AN ESTIMATE: verify against https://aistudio.google.com/docs/pricing before
 * trusting it (2026-11-06: $12 / 1M output tokens; 360p 1,931 tok/s, 720p 5,792, 1080p upsampled 8,688).
 * Unknown model ids are priced with the default model's table.
 */
const PRICE_USD_PER_SECOND: Record<string, Record<string, number>> = {
  [DEFAULT_MODEL]: { "360p": 0.023, "720p": 0.07, "1080p": 0.104 },
};
const MIN_CLIP_S = 3; // the API takes whole seconds, 3 to 15
const MAX_CLIP_S = 15;
const MAX_TOTAL_S = 60;
const TAIL_S = 0.5; // footage runs this long after the voice ends
const WORDS_PER_SECOND = 2.5;
const MAX_PARALLEL = 2;
const CLIP_VOLUME = 0.12;
const NO_TEXT = " Do not show any on-screen text, captions, subtitles or logos.";

const run = promisify(execFile);

function speechSeconds(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND;
}

/** Throws a plain-English reason when the request cannot be made; returns the seconds per clip to use. */
function validate(input: MakeVideoInput): number {
  const title = input.title?.trim() ?? "";
  const script = input.script?.trim() ?? "";
  if (title.length < 1 || title.length > 100) throw new Error("The title must be 1 to 100 characters.");
  if (script.length < 1 || script.length > 1200) throw new Error("The script must be 1 to 1200 characters.");
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 6) throw new Error("Give 1 to 6 scenes.");
  input.scenes.forEach((s, i) => {
    const n = s?.prompt?.trim().length ?? 0;
    if (n < 1 || n > 600) throw new Error(`Scene ${i + 1} needs a prompt of 1 to 600 characters.`);
  });
  if (input.quality !== undefined && !Object.hasOwn(RESOLUTION, input.quality)) throw new Error("Quality must be lite, fast or standard.");
  const speech = speechSeconds(script);
  if (speech + TAIL_S > MAX_TOTAL_S) throw new Error(`The script takes about ${Math.round(speech)} s to read; a Short is at most ${MAX_TOTAL_S} s. Shorten it.`);
  const n = input.scenes.length;
  const sps = input.secondsPerScene ?? Math.min(MAX_CLIP_S, Math.floor(MAX_TOTAL_S / n), Math.max(MIN_CLIP_S, Math.ceil((speech + TAIL_S) / n)));
  if (!Number.isInteger(sps) || sps < MIN_CLIP_S || sps > MAX_CLIP_S) throw new Error(`Seconds per scene must be a whole number from ${MIN_CLIP_S} to ${MAX_CLIP_S}.`);
  if (sps * n > MAX_TOTAL_S) throw new Error(`${n} scenes of ${sps} s is ${sps * n} s of footage; the most is ${MAX_TOTAL_S} s.`);
  return sps;
}

export function estimateUsd(input: MakeVideoInput, model: string): number {
  const sps = validate(input);
  const prices = PRICE_USD_PER_SECOND[model] ?? PRICE_USD_PER_SECOND[DEFAULT_MODEL]!;
  return Math.round(input.scenes.length * sps * prices[RESOLUTION[input.quality ?? "lite"]]! * 100) / 100;
}

async function api(deps: StudioVideoDeps, url: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> {
  const res = await deps.fetch(url, { ...init, signal, headers: { "x-goog-api-key": deps.apiKey, "content-type": "application/json" } });
  if (res.ok) return res;
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  throw new Error(`The video service refused the request (HTTP ${res.status}): ${(body.error?.message ?? res.statusText).slice(0, 300)}`);
}

interface VideoPart { type?: string; uri?: string; data?: string }
interface Interaction { id?: string; status?: string; steps?: { type?: string; content?: VideoPart[] }[] }

/** Generates one clip and writes it to `file`. */
async function generateClip(deps: StudioVideoDeps, prompt: string, seconds: number, resolution: string, model: string, file: string, signal: AbortSignal): Promise<void> {
  const res = await api(deps, `${API}/interactions`, signal, {
    method: "POST",
    body: JSON.stringify({
      model,
      input: prompt.trim() + NO_TEXT,
      background: false,
      stream: false,
      response_format: { type: "video", aspect_ratio: "9:16", resolution, duration: `${seconds}s`, delivery: "uri" },
    }),
  });
  const interaction = (await res.json()) as Interaction;
  if (interaction.status !== "completed") throw new Error(`The video service did not finish the clip (status ${interaction.status ?? "unknown"}).`);
  const part = interaction.steps?.filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []).find((c) => c.type === "video");
  if (part?.data) return writeFile(file, Buffer.from(part.data, "base64"));
  const id = part?.uri?.match(/files\/([^/:?]+)/)?.[1];
  if (!id) throw new Error("The video service returned no video.");
  const sleep = deps.sleep ?? ((ms: number) => delay(ms, undefined, { signal }));
  for (;;) {
    signal.throwIfAborted();
    const state = ((await (await api(deps, `${API}/files/${id}`, signal)).json()) as { state?: string }).state;
    if (state === "ACTIVE") break;
    if (state === "FAILED") throw new Error("The video service failed to make a clip.");
    await sleep(deps.pollMs ?? 5000);
    signal.throwIfAborted();
  }
  const video = await api(deps, `${API}/files/${id}:download?alt=media`, signal);
  await writeFile(file, Buffer.from(await video.arrayBuffer()));
}

function pcm16(samples: Float32Array): Buffer {
  const out = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  return out;
}

const stamp = (ms: number) => new Date(Math.round(ms)).toISOString().slice(11, 23).replace(".", ",");

/** One cue per sentence, timed in proportion to its length across the voiceover. */
export function buildSrt(script: string, voiceMs: number): string {
  const sentences = (script.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
  const total = sentences.reduce((n, s) => n + s.length, 0);
  let at = 0;
  return sentences.map((s, i) => {
    const end = at + (voiceMs * s.length) / total;
    const cue = `${i + 1}\n${stamp(at)} --> ${stamp(end)}\n${s}\n`;
    at = end;
    return cue;
  }).join("\n");
}

function slug(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "") || "video";
}

async function hasAudio(ffprobe: string, file: string): Promise<boolean> {
  const { stdout } = await run(ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
  return stdout.trim().length > 0;
}

async function durationMs(ffprobe: string, file: string): Promise<number> {
  const { stdout } = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Math.round(Number(stdout.trim()) * 1000);
}

const AUDIO_FMT = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";

/** Clips → one 1080x1920 30 fps track (with the clips' audio when every clip has some), then loop/trim to `seconds` and mix the voice over it. */
async function assemble(deps: StudioVideoDeps, clips: string[], voice: string, seconds: number, footage: string, out: string, signal: AbortSignal): Promise<void> {
  // ponytail: clip audio is kept only when every clip has it (mixed clips would need silent filler); Omni clips always have audio.
  const withAudio = (await Promise.all(clips.map((c) => hasAudio(deps.ffprobe, c)))).every(Boolean);
  const scale = clips.map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v${i}];` +
    (withAudio ? `[${i}:a]${AUDIO_FMT}[a${i}];` : "")).join("");
  const pairs = clips.map((_, i) => (withAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
  const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30"];
  await run(deps.ffmpeg, [
    "-y", "-v", "error", ...clips.flatMap((c) => ["-i", c]),
    "-filter_complex", `${scale}${pairs}concat=n=${clips.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? "[a]" : ""}`,
    "-map", "[v]", ...(withAudio ? ["-map", "[a]", "-c:a", "aac"] : []), ...enc, footage,
  ], { signal, maxBuffer: 16 << 20 });
  const mix = withAudio
    ? `[1:a]${AUDIO_FMT},apad[vo];[0:a]volume=${CLIP_VOLUME}[bg];[vo][bg]amix=inputs=2:duration=first:normalize=0[a]`
    : `[1:a]${AUDIO_FMT},apad[a]`;
  await run(deps.ffmpeg, [
    "-y", "-v", "error", "-stream_loop", "-1", "-i", footage, "-i", voice,
    "-filter_complex", mix, "-map", "0:v", "-map", "[a]", "-t", seconds.toFixed(3),
    ...enc, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out,
  ], { signal, maxBuffer: 16 << 20 });
}

export async function makeVideo(input: MakeVideoInput, deps: StudioVideoDeps, signal?: AbortSignal): Promise<MakeVideoResult> {
  const started = Date.now();
  const model = deps.model ?? DEFAULT_MODEL;
  const sps = validate(input);
  const estimatedUsd = estimateUsd(input, model);
  const maxUsd = deps.maxUsd ?? 5;
  if (estimatedUsd > maxUsd) throw new Error(`This video would cost about $${estimatedUsd.toFixed(2)}, above the $${maxUsd.toFixed(2)} limit. Use fewer or shorter scenes, or a lower quality.`);

  await mkdir(deps.outDir, { recursive: true });
  const work = join(deps.outDir, `.studio-${randomUUID()}`);
  const base = join(deps.outDir, `${slug(input.title)}-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`);
  const file = `${base}.mp4`;
  const srt = `${base}.srt`;
  // One controller for the run: the caller's abort or the first failed clip stops the rest.
  const stop = new AbortController();
  const onAbort = () => stop.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    await mkdir(work);
    // The voice is local and free, so it goes first: a script that reads too long is refused before any spend.
    const speech = await deps.synthesize(input.script.trim());
    const voiceMs = (speech.samples.length / speech.sampleRate) * 1000;
    if (voiceMs + TAIL_S * 1000 > MAX_TOTAL_S * 1000) throw new Error(`The voiceover is ${Math.round(voiceMs / 1000)} s; a Short is at most ${MAX_TOTAL_S} s. Shorten the script.`);
    const voice = join(work, "voice.wav");
    await writeFile(voice, toWav({ pcm: pcm16(speech.samples), sampleRate: speech.sampleRate, durationMs: voiceMs }));
    stop.signal.throwIfAborted();

    const clips = input.scenes.map((_, i) => join(work, `clip-${i}.mp4`));
    const resolution = RESOLUTION[input.quality ?? "lite"];
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < clips.length; i = next++) {
        stop.signal.throwIfAborted();
        const t0 = Date.now();
        deps.log?.("studio.clip.start", { index: i });
        await generateClip(deps, input.scenes[i]!.prompt, sps, resolution, model, clips[i]!, stop.signal);
        deps.log?.("studio.clip.done", { index: i, ms: Date.now() - t0 });
      }
    };
    // allSettled: wait for both workers to stop before the work folder is deleted.
    const runs = await Promise.allSettled(Array.from({ length: Math.min(MAX_PARALLEL, clips.length) }, () => worker().catch((e) => { stop.abort(e); throw e; })));
    const failed = runs.find((r) => r.status === "rejected");
    if (failed) throw stop.signal.aborted ? stop.signal.reason : failed.reason; // the first failure, not the abort it caused

    await assemble(deps, clips, voice, Math.min(MAX_TOTAL_S, voiceMs / 1000 + TAIL_S), join(work, "footage.mp4"), file, stop.signal);
    await writeFile(srt, buildSrt(input.script, voiceMs));
    const result = { file, srt, durationMs: await durationMs(deps.ffprobe, file), clips: clips.length, estimatedUsd, model };
    deps.log?.("studio.video.done", { clips: result.clips, durationMs: result.durationMs, ms: Date.now() - started });
    return result;
  } catch (error) {
    await Promise.all([rm(file, { force: true }), rm(srt, { force: true })]);
    throw signal?.aborted ? new Error("Making the video was stopped.", { cause: error }) : error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await rm(work, { recursive: true, force: true });
  }
}
