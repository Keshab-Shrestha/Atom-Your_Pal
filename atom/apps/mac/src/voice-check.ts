// Voice check: tests speech output and speech input on their own, with no AI and no conversation.
//
//   pnpm voice:check            speak, transcribe ATOM's own speech, then transcribe you
//   pnpm voice:check --no-mic   skip the live microphone step
//
// 1. TTS   Kokoro speaks a sentence aloud (you hear it).
// 2. STT   Whisper transcribes a recording of that same sentence (no microphone involved), so a wrong
//          result here points at Whisper or the model, not at the microphone.
// 3. MIC   You speak for a few seconds; Whisper transcribes what the microphone heard.
// Nothing is sent over the network and nothing is logged or saved.

import { readEnv } from "@atom/shared";
import { startRecording, type AudioClip } from "./audio.ts";
import { createWhisperStt } from "./stt.ts";
import { createKokoroSynthesizer, createSpeaker } from "./tts.ts";

const SENTENCE = "Hello Keshab. This is ATOM checking that it can speak and listen.";
const SAMPLE_RATE = 16_000;
const LISTEN_MS = 6_000;

const env = process.env;
const voice = readEnv(env, "ATOM_TTS_VOICE") ?? "af_heart";
const dtype = (readEnv(env, "ATOM_TTS_DTYPE") ?? "fp32") as "q8" | "fp32";
const inputDevice = readEnv(env, "ATOM_AUDIO_INPUT_DEVICE") ?? ":default";
const withMic = !process.argv.includes("--no-mic");

const stt = createWhisperStt({
  modelPath: readEnv(env, "ATOM_STT_MODEL") ?? "models/ggml-small.en.bin",
  language: readEnv(env, "ATOM_STT_LANGUAGE") ?? "en",
  vocabulary: readEnv(env, "ATOM_STT_VOCABULARY") ?? "ATOM, Keshab",
});
const synthesizer = createKokoroSynthesizer({ voice, dtype });
const tts = createSpeaker(synthesizer);

const ms = (since: number) => `${Date.now() - since} ms`;
const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/** Share of the expected words that Whisper returned, in order (longest common subsequence), so one wrong word costs one word. */
function wordMatch(expected: string, heard: string): number {
  const want = words(expected);
  const got = words(heard);
  const table = Array.from({ length: want.length + 1 }, () => new Array<number>(got.length + 1).fill(0));
  for (let i = 1; i <= want.length; i += 1) {
    for (let j = 1; j <= got.length; j += 1) {
      table[i]![j] = want[i - 1] === got[j - 1] ? table[i - 1]![j - 1]! + 1 : Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
    }
  }
  return want.length === 0 ? 0 : table[want.length]![got.length]! / want.length;
}

/** Linear resample of 32-bit float samples to 16-bit PCM at `rate`. */
function toClip(samples: Float32Array, from: number, rate: number): AudioClip {
  const count = Math.floor((samples.length * rate) / from);
  const pcm = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i += 1) {
    const at = (i * from) / rate;
    const a = samples[Math.floor(at)] ?? 0;
    const b = samples[Math.min(Math.floor(at) + 1, samples.length - 1)] ?? a;
    const v = a + (b - a) * (at - Math.floor(at));
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  return { pcm, sampleRate: rate, durationMs: Math.round((count / rate) * 1000) };
}

function peakDb(clip: AudioClip): string {
  let peak = 0;
  for (let i = 0; i + 1 < clip.pcm.length; i += 2) peak = Math.max(peak, Math.abs(clip.pcm.readInt16LE(i)));
  return peak === 0 ? "silence" : `${Math.round(20 * Math.log10(peak / 32768))} dB`;
}

async function step(name: string, run: () => Promise<void>): Promise<boolean> {
  console.log(`\n── ${name}`);
  try {
    await run();
    return true;
  } catch (error) {
    console.log(`   FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

const results: Record<string, boolean> = {};

results.tts = await step(`1. TTS — Kokoro (${voice}, ${dtype}) speaks: "${SENTENCE}"`, async () => {
  let started = Date.now();
  await tts.warmUp();
  console.log(`   model ready in ${ms(started)}`);
  started = Date.now();
  let firstSound = -1;
  await tts.speak(SENTENCE, undefined, { onStart: () => (firstSound = Date.now() - started) });
  console.log(`   first sound after ${firstSound} ms, finished after ${ms(started)}. Did you hear it?`);
});

results.stt = await step("2. STT — Whisper transcribes ATOM's own speech (no microphone)", async () => {
  await synthesizer.load();
  const audio = await synthesizer.synthesize(SENTENCE);
  const clip = toClip(audio.samples, audio.sampleRate, SAMPLE_RATE);
  const started = Date.now();
  const heard = await stt.transcribe(clip);
  const match = wordMatch(SENTENCE, heard);
  console.log(`   clip ${clip.durationMs} ms → "${heard}" in ${ms(started)}`);
  console.log(`   ${Math.round(match * 100)}% of the words matched`);
  if (match < 0.8) throw new Error("fewer than 80% of the words matched");
});

if (withMic) {
  results.mic = await step(`3. MIC — Whisper transcribes you (device ${inputDevice})`, async () => {
    await tts.speak("Now say something. You have six seconds.");
    console.log(`   Listening for ${LISTEN_MS / 1000} s… speak now.`);
    const recording = await new Promise<ReturnType<typeof startRecording>>((resolve, reject) => {
      const r = startRecording({ inputDevice, sampleRate: SAMPLE_RATE }, {
        onReady: () => resolve(r),
        onFailure: reject,
      });
      setTimeout(() => reject(new Error("the microphone did not start within 8 s")), 8000).unref();
    });
    await new Promise((r) => setTimeout(r, LISTEN_MS));
    const clip = await recording.stop();
    console.log(`   recorded ${clip.durationMs} ms, loudest ${peakDb(clip)}`);
    const started = Date.now();
    const heard = await stt.transcribe(clip);
    console.log(`   heard: "${heard}" (${ms(started)})`);
    if (!heard) throw new Error(`no speech recognised (loudest ${peakDb(clip)}; speech is usually louder than -30 dB)`);
  });
}

tts.close();
console.log(`\n${Object.entries(results).map(([k, ok]) => `${k.toUpperCase()} ${ok ? "ok" : "FAILED"}`).join("   ")}`);
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
