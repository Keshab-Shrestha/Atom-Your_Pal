import { spawn as nodeSpawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

/** Text-to-speech boundary. The rest of ZENO depends on this, not on Kokoro or ffmpeg. */
export interface TextToSpeech {
  /** Loads models ahead of time so the first reply is not delayed. Safe to call more than once. */
  warmUp(): Promise<void>;
  /** Speaks the text aloud. Resolves when playback ends; aborting stops it immediately. */
  speak(text: string, signal?: AbortSignal): Promise<void>;
}

export class TtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsError";
  }
}

/** Mono audio as 32-bit float samples in [-1, 1]. */
export interface SpeechAudio {
  samples: Float32Array;
  sampleRate: number;
}

/** Turns text into audio. Kokoro implements this; tests use a fake. */
export interface Synthesizer {
  load(): Promise<void>;
  synthesize(text: string): Promise<SpeechAudio>;
}

/** A continuous audio output for one utterance: chunks written to it play back to back, without gaps. */
export interface AudioSink {
  write(samples: Float32Array): void;
  /** No more audio is coming; resolves once everything written has finished playing. */
  finish(): Promise<void>;
  /** Stops playback immediately. */
  stop(): void;
}

export type OpenSink = (sampleRate: number) => AudioSink;

/**
 * Speaks sentence by sentence into one continuous audio stream.
 * Playback starts as soon as the first sentence is synthesized; later sentences are
 * synthesized while earlier ones play (synthesis runs faster than real time).
 */
export function createSpeaker(synthesizer: Synthesizer, openSink: OpenSink = openFfmpegSink): TextToSpeech {
  let loading: Promise<void> | null = null;
  const warmUp = () => {
    loading ??= synthesizer.load().catch((error) => {
      loading = null; // allow a retry
      throw error;
    });
    return loading;
  };

  return {
    warmUp,
    async speak(text, signal = new AbortController().signal) {
      const sentences = splitSentences(text);
      if (sentences.length === 0 || signal.aborted) return;
      await warmUp();

      let sink: AudioSink | null = null;
      let onAbort: () => void = () => {};
      const aborted = new Promise<null>((r) => (onAbort = () => r(null)));
      const stop = () => {
        sink?.stop();
        onAbort();
      };
      signal.addEventListener("abort", stop, { once: true });
      try {
        for (const sentence of sentences) {
          const synthesis = synthesizer.synthesize(sentence);
          synthesis.catch(() => {}); // an abandoned synthesis must not surface as unhandled
          // Return as soon as we are aborted, without waiting for the sentence being synthesized.
          const audio = await Promise.race([synthesis, aborted]);
          if (!audio || signal.aborted) return;
          sink ??= openSink(audio.sampleRate);
          sink.write(audio.samples);
        }
        await sink?.finish();
      } finally {
        signal.removeEventListener("abort", stop);
        if (signal.aborted) sink?.stop();
      }
    },
  };
}

/** Splits text into sentences for incremental speech; very short fragments are merged. */
export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g);
  if (!parts) return [];
  const sentences: string[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const last = sentences.length - 1;
    // Merge fragments like "Dr." or "Ok." into a neighbour so they are not spoken alone.
    if (last >= 0 && (part.length < 8 || sentences[last].length < 8)) sentences[last] += ` ${part}`;
    else sentences.push(part);
  }
  return sentences;
}

// ---------------------------------------------------------------------------
// Kokoro (ADR-029): local ONNX speech synthesis.

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export interface KokoroOptions {
  /** Kokoro voice id, e.g. "af_heart". */
  voice: string;
  /** Model precision: "q8" (~90 MB, default) or "fp32" (~330 MB, highest quality). */
  dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  speed?: number;
  /** Where downloaded model files are kept. */
  cacheDir?: string;
}

export function createKokoroSynthesizer(options: KokoroOptions): Synthesizer {
  const { voice, dtype = "q8", speed = 1, cacheDir = resolve("models/huggingface") } = options;
  let worker: Worker | null = null;
  let loading: Promise<void> | null = null;
  let nextId = 0;
  const pending = new Map<number, { resolve: (a: SpeechAudio) => void; reject: (e: Error) => void }>();

  // The worker only keeps ZENO running while it has work to do.
  const updateRef = () => (pending.size > 0 ? worker?.ref() : worker?.unref());

  const failAll = (error: Error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  return {
    load() {
      loading ??= new Promise<void>((resolveLoad, rejectLoad) => {
        const w = new Worker(new URL("./tts-worker.ts", import.meta.url), {
          workerData: { modelId: KOKORO_MODEL_ID, voice, dtype, speed, cacheDir },
        });
        worker = w;
        w.on("message", (message: WorkerMessage) => {
          if (message.type === "ready") {
            w.unref();
            resolveLoad();
          } else if (message.type === "load-error") {
            loading = null; // allow a retry
            void w.terminate();
            rejectLoad(
              new TtsError(
                message.known
                  ? message.message
                  : `Could not load Kokoro (${message.message}). The first run downloads the model and needs internet.`,
              ),
            );
          } else {
            const request = pending.get(message.id);
            if (!request) return;
            pending.delete(message.id);
            updateRef();
            if (message.type === "audio") request.resolve({ samples: message.samples, sampleRate: message.sampleRate });
            else request.reject(new TtsError(`Speech synthesis failed: ${message.message}`));
          }
        });
        w.on("error", (error) => {
          loading = null;
          worker = null;
          const tts = new TtsError(`Kokoro worker crashed: ${error.message}`);
          failAll(tts);
          rejectLoad(tts);
        });
      });
      return loading;
    },
    synthesize(text) {
      if (!worker) return Promise.reject(new TtsError("Kokoro is not loaded"));
      const id = nextId++;
      const result = new Promise<SpeechAudio>((resolveAudio, reject) => pending.set(id, { resolve: resolveAudio, reject }));
      updateRef();
      worker.postMessage({ id, text });
      return result;
    },
  };
}

type WorkerMessage =
  | { type: "ready" }
  | { type: "load-error"; message: string; known: boolean }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "error"; id: number; message: string };

// ---------------------------------------------------------------------------
// Playback: ffmpeg writes raw samples to the macOS default output (AudioToolbox).
// One process per utterance, so sentences play back to back with no startup gap.

type PlayerProcess = ChildProcessByStdio<Writable, null, Readable>;

export interface FfmpegSinkOptions {
  spawn?: (command: string, args: string[]) => PlayerProcess;
}

export function openFfmpegSink(sampleRate: number, options: FfmpegSinkOptions = {}): AudioSink {
  const { spawn = (c, a) => nodeSpawn(c, a, { stdio: ["pipe", "ignore", "pipe"] }) } = options;
  // Arguments are fixed values plus a number; no user text reaches the command line.
  const args = ["-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", String(sampleRate), "-ac", "1", "-i", "pipe:0", "-f", "audiotoolbox", "-"];
  const child = spawn("ffmpeg", args);
  let stopped = false;
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdin.on("error", () => {}); // EPIPE after stop() is expected

  const closed = new Promise<void>((resolveClose, reject) => {
    child.once("error", (error: NodeJS.ErrnoException) =>
      reject(new TtsError(error.code === "ENOENT" ? "ffmpeg not found (install with: brew install ffmpeg)" : `Playback failed: ${error.message}`)),
    );
    child.once("close", (code) => {
      if (code === 0 || stopped) resolveClose();
      else reject(new TtsError(`Playback failed (ffmpeg exit code ${code}): ${stderr.trim().split("\n").pop() ?? ""}`));
    });
  });
  closed.catch(() => {}); // surfaced by finish(); avoids an unhandled rejection after stop()

  return {
    write(samples) {
      if (stopped) return;
      child.stdin.write(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    },
    finish() {
      if (!stopped) child.stdin.end();
      return closed;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      child.kill("SIGKILL"); // immediate: SIGTERM lets ffmpeg drain its audio buffer first
    },
  };
}
