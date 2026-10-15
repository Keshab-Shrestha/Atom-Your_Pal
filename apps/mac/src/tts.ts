import { fork, spawn as nodeSpawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import { resolve } from "node:path";

/** Text-to-speech boundary. The rest of ATOM depends on this, not on Kokoro or ffmpeg. */
export interface TextToSpeech {
  /** Loads models ahead of time so the first reply is not delayed. Safe to call more than once. */
  warmUp(): Promise<void>;
  /** Stops speaking and releases the speech engine; used when ATOM quits. */
  close(): void;
  /** Speaks the text aloud. Resolves when playback ends; aborting stops it immediately. */
  speak(text: string, signal?: AbortSignal, hooks?: SpeakHooks): Promise<void>;
  /**
   * Speaks text that is still being written (ADR-065): each sentence is spoken as soon as it is complete.
   * Resolves when the stream has ended and everything has been played.
   */
  speakStream?(text: AsyncIterable<string>, signal?: AbortSignal, hooks?: SpeakHooks): Promise<void>;
}

export interface SpeakHooks {
  /** Called when audio starts playing. */
  onStart?: () => void;
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
  /** Releases the engine immediately (safe mid-synthesis). Optional. */
  close?(): void;
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
  const active = new Set<() => void>();

  return {
    warmUp,
    close() {
      for (const stop of active) stop();
      synthesizer.close?.();
    },
    speak(text, signal, hooks) {
      return this.speakStream!(
        (async function* () {
          yield text;
        })(),
        signal,
        hooks,
      );
    },
    async speakStream(text, signal = new AbortController().signal, hooks = {}) {
      if (signal.aborted) return;
      const sentences = streamSentences(text);
      let loaded = false;

      let sink: AudioSink | null = null;
      let onAbort: () => void = () => {};
      const aborted = new Promise<null>((r) => (onAbort = () => r(null)));
      const stop = () => {
        sink?.stop();
        onAbort();
      };
      signal.addEventListener("abort", stop, { once: true });
      active.add(stop);
      try {
        for await (const sentence of sentences) {
          if (signal.aborted) return;
          if (!loaded) {
            await warmUp(); // only once there is something to say
            loaded = true;
            if (signal.aborted) return;
          }
          const synthesis = synthesizer.synthesize(sentence);
          synthesis.catch(() => {}); // an abandoned synthesis must not surface as unhandled
          // Return as soon as we are aborted, without waiting for the sentence being synthesized.
          const audio = await Promise.race([synthesis, aborted]);
          if (!audio || signal.aborted) return;
          if (!sink) {
            sink = openSink(audio.sampleRate);
            hooks.onStart?.();
          }
          sink.write(audio.samples);
        }
        await sink?.finish();
      } finally {
        active.delete(stop);
        signal.removeEventListener("abort", stop);
        if (signal.aborted) sink?.stop();
      }
    },
  };
}

/**
 * Time to first sound grows with the length of the first chunk (synthesis runs at ~0.45× real time),
 * so a long opening sentence is split at its first comma: speech starts sooner, and the rest is
 * synthesized while the opening plays.
 */
export function splitFirstClause(sentences: string[], longerThan = 35, minClause = 12): string[] {
  const [first, ...rest] = sentences;
  if (!first || first.length <= longerThan) return sentences;
  const cut = openingCut(first, minClause);
  if (cut < 0) return sentences;
  return [first.slice(0, cut).trim(), first.slice(cut).trim(), ...rest];
}

/** Words a speaker naturally pauses before. */
const BREAK_WORDS = /\s(?=(?:because|and|but|so|which|when|while|since|although|though|that|with|called|or|if)\s)/gi;

/**
 * Where to cut a long opening sentence so its first part is short to synthesize (Kokoro takes ~0.25 s per second of
 * speech, plus a fixed ~0.35 s): after its first comma, else before a word people pause at ("because", "and").
 * -1 if there is no good place (both parts must be at least `minClause` characters; the first part at most ~50).
 */
export function openingCut(text: string, minClause = 12): number {
  const comma = text.indexOf(", ", minClause);
  if (comma > 0 && comma <= 60 && text.length - comma > minClause) return comma + 1;
  for (const m of text.matchAll(BREAK_WORDS)) {
    const at = m.index!;
    if (at < minClause) continue;
    if (at > 50 || text.length - at <= minClause) break;
    return at;
  }
  return -1;
}

/**
 * Turns text arriving in pieces into speakable sentences as soon as each one is complete (ADR-065).
 * A sentence is complete when its end mark is followed by more text; whatever is left is spoken when the stream ends.
 * The opening sentence is cut at a comma if it runs long, as `splitFirstClause` does, so speech starts sooner.
 */
export async function* streamSentences(pieces: AsyncIterable<string>): AsyncGenerator<string> {
  let buffer = "";
  let first = true;
  const emit = function* (raw: string) {
    let parts = splitSentences(toSpeakable(raw));
    if (first) parts = splitFirstClause(parts);
    if (parts.length) first = false;
    yield* parts;
  };
  for await (const piece of pieces) {
    buffer += piece;
    for (;;) {
      // the end of a sentence (or a line) at least 8 characters in, with more text after it
      const ends = /[.!?]["')\]]*(?=\s+\S)|\n+(?=\S)/g;
      let cut = -1;
      for (let m = ends.exec(buffer); m; m = ends.exec(buffer)) {
        const at = m.index + m[0].length;
        if (buffer.slice(0, at).trim().length >= 8) {
          cut = at;
          break;
        }
      }
      if (cut > 0) {
        const sentence = buffer.slice(0, cut);
        buffer = buffer.slice(cut).replace(/^\s+/, "");
        yield* emit(sentence);
        continue;
      }
      // a long opening with no end yet: speak up to its first comma
      if (first && buffer.length > 35) {
        const cut = openingCut(buffer);
        if (cut > 0) {
          const clause = buffer.slice(0, cut);
          buffer = buffer.slice(cut).replace(/^\s+/, "");
          first = false;
          yield* splitSentences(toSpeakable(clause));
          continue;
        }
      }
      break;
    }
  }
  if (buffer.trim()) yield* emit(buffer);
}

/**
 * Models are told to answer in plain sentences, but sometimes reply with markdown or emoji anyway.
 * Strip what would otherwise be read aloud as symbols; list items and headings become sentences.
 */
export function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // code blocks cannot be spoken usefully
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [label](url) → label
    .replace(/https?:\/\/(?:www\.)?([^\/\s]+)\S*/g, "$1") // URL → its domain
    .split(/\n+/)
    .map((line) =>
      (/^\s*\|/.test(line) ? "" : line) // table rows stay on screen
        .replace(/^\s*(?:#{1,6}\s+|[-*+•]\s+|\d+[.)]\s+|>\s*)/, "") // headings, bullets, numbers, quotes
        .replace(/(\*\*|__|\*|`|~~)/g, "") // emphasis and inline code markers
        .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u200D\uFE0F]/gu, "") // emoji, incl. flags
        .trim(),
    )
    .filter(Boolean)
    .map((line) => (/[.!?:;,]$/.test(line) ? line : `${line}.`)) // each line ends as a sentence
    .join(" ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits text into sentences for incremental speech; very short fragments are merged. */
export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .trim()
    // A "." between two digits (3.14, 2.5.1, 10.30) is not the end of a sentence.
    .match(/(?:[^.!?]|(?<=\d)\.(?=\d))+(?:[.!?]+["')\]]*|$)/g);
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
  /** Model precision: "fp32" (~330 MB, default: highest quality and, on Apple silicon, fastest) or "q8" (~90 MB). */
  dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  speed?: number;
  /** Where downloaded model files are kept. */
  cacheDir?: string;
}

export function createKokoroSynthesizer(options: KokoroOptions): Synthesizer {
  const { voice, dtype = "fp32", speed = 1, cacheDir = resolve("models/huggingface") } = options;
  let child: ChildProcess | null = null;
  let loading: Promise<void> | null = null;
  let nextId = 0;
  const pending = new Map<number, { resolve: (a: SpeechAudio) => void; reject: (e: Error) => void }>();

  // The child keeps ATOM running only while it has work to do.
  const updateRef = () => {
    if (!child) return;
    const ipc = child.channel as { ref(): void; unref(): void } | undefined;
    if (pending.size > 0) {
      child.ref();
      ipc?.ref();
    } else {
      child.unref();
      ipc?.unref();
    }
  };

  const failAll = (error: Error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  return {
    load() {
      loading ??= new Promise<void>((resolveLoad, rejectLoad) => {
        const proc = fork(fileURLToPath(new URL("./tts-worker.ts", import.meta.url)), [], {
          serialization: "advanced", // sends Float32Array audio without converting it to JSON
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        });
        child = proc;
        let stderr = "";
        proc.stderr?.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)));
        (proc.stderr as unknown as { unref?(): void } | null)?.unref?.(); // only the IPC channel decides whether ATOM stays alive
        proc.on("message", (message: WorkerMessage) => {
          if (message.type === "ready") {
            updateRef();
            resolveLoad();
          } else if (message.type === "load-error") {
            loading = null; // allow a retry
            child = null;
            proc.kill("SIGKILL");
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
        proc.on("exit", (code, signal) => {
          if (child !== proc) return; // intentionally stopped
          child = null;
          loading = null; // the next request starts a fresh process
          const detail = stderr.trim().split("\n").filter(Boolean).pop();
          const error = new TtsError(`Kokoro stopped unexpectedly (${signal ?? `exit code ${code}`})${detail ? `: ${detail}` : ""}`);
          failAll(error);
          rejectLoad(error);
        });
        proc.send({ type: "init", modelId: KOKORO_MODEL_ID, voice, dtype, speed, cacheDir });
      });
      return loading;
    },
    async synthesize(text) {
      if (!child) await this.load(); // restarts Kokoro if it crashed
      const proc = child!;
      const id = nextId++;
      const result = new Promise<SpeechAudio>((resolveAudio, reject) => pending.set(id, { resolve: resolveAudio, reject }));
      updateRef();
      proc.send({ type: "synthesize", id, text });
      return result;
    },
    close() {
      const proc = child;
      child = null;
      loading = null;
      failAll(new TtsError("Kokoro was shut down"));
      proc?.kill("SIGKILL"); // safe at any time: it is a separate process
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
