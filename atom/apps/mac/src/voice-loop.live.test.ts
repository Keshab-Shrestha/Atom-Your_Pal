import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, readEnv } from "@atom/shared";
import type { AudioClip } from "./audio.ts";
import { createNativeCore } from "./native-core.ts";
import { createWhisperStt } from "./stt.ts";
import { createKokoroSynthesizer, createSpeaker } from "./tts.ts";
import { createVoiceLoop, type TurnTimings } from "./voice-loop.ts";

// The whole voice loop with real components: speech (made with macOS `say` instead of the microphone)
// → Whisper → Core → Claude Code (native session) → Kokoro → your speakers.
// Costs two provider requests and plays audio. Run with: pnpm test:live
// The session closes this long after the last turn; its process would otherwise keep the test run open for minutes.
const LIVE_IDLE_MS = 20_000;
const enabled = readEnv(process.env, "ATOM_LIVE_TESTS") === "1";

function speech(text: string): AudioClip {
  const dir = mkdtempSync(join(tmpdir(), "atom-e2e-"));
  try {
    execFileSync("say", ["-o", join(dir, "q.aiff"), text]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-i", join(dir, "q.aiff"), "-ac", "1", "-ar", "16000", "-f", "s16le", join(dir, "q.pcm")]);
    const pcm = readFileSync(join(dir, "q.pcm"));
    return { pcm, sampleRate: 16_000, durationMs: Math.round((pcm.length / 2 / 16_000) * 1000) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("live: spoken questions are answered aloud, with conversation memory", { skip: !enabled && "set ATOM_LIVE_TESTS=1 (pnpm test:live)", timeout: 120_000 }, async (t) => {
  const config = loadConfig();
  const tts = createSpeaker(createKokoroSynthesizer({ voice: config.tts.voice, dtype: config.tts.dtype }));
  await tts.warmUp();
  // ADR-110 N5: the native engine on the Claude plan (config.llm.apiKey is the path of the signed-in `claude` program).
  const core = createNativeCore({ claudePath: config.llm.apiKey, tools: { specs: () => [], run: async (call) => ({ callId: call.id, content: "No tools in this test.", isError: true }) }, modelFor: () => config.llm.model, timeoutMs: config.llm.timeoutMs, idleMs: LIVE_IDLE_MS });

  let clip: AudioClip;
  let turn: { heard: string; reply: string; timings?: TurnTimings; error?: unknown };
  let finish = () => {};
  const loop = createVoiceLoop({
    record: (hooks) => {
      queueMicrotask(() => hooks.onReady()); // a real microphone reports ready once audio flows
      return { stop: async () => clip };
    },
    stt: createWhisperStt({
      modelPath: config.stt.modelPath,
      language: config.stt.language,
      vocabulary: config.stt.vocabulary,
    }),
    core,
    tts,
    events: {
      onTranscript: (text) => (turn.heard = text),
      onReply: (text) => (turn.reply = text),
      onTurnComplete: (timings) => ((turn.timings = timings), finish()),
      onNotice: (notice) => ((turn.error = `notice: ${notice.kind}`), finish()),
      onError: (stage, error) => ((turn.error = `${stage}: ${(error as Error).message}`), finish()),
    },
  });

  async function ask(question: string) {
    clip = speech(question);
    turn = { heard: "", reply: "" };
    const done = new Promise<void>((resolve) => (finish = resolve));
    loop.press();
    await new Promise((resolve) => setImmediate(resolve)); // wait for "listening", as a person would
    loop.press();
    await done;
    assert.equal(turn.error, undefined);
    const ms = turn.timings!;
    t.diagnostic(`heard "${turn.heard}" → "${turn.reply}" (stt ${ms.transcription} ms, model ${ms.model} ms, first sound ${ms.firstSound} ms)`);
    return turn;
  }

  const first = await ask("Hi, my name is Keshab. What is the capital of Japan?");
  assert.match(first.heard, /capital of Japan/i);
  assert.match(first.reply, /Tokyo/i);

  const second = await ask("What is my name?");
  assert.match(second.reply, /Kesh/i); // remembered from the first turn (Whisper may spell it "Kesheb")
});
