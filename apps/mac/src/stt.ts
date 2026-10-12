import { execFile as nodeExecFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AudioClip } from "./audio.ts";

/** Speech-to-text boundary. The rest of ATOM depends on this, not on Whisper. */
export interface SpeechToText {
  /** Returns the transcribed text, or "" if no speech was recognized. */
  transcribe(clip: AudioClip): Promise<string>;
}

export class SttError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttError";
  }
}

type ExecFile = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
  callback: (error: (Error & { code?: string | number; killed?: boolean }) | null, stdout: string, stderr: string) => void,
) => unknown;

export interface WhisperOptions {
  /** Path to a ggml Whisper model, e.g. models/ggml-base.en.bin */
  modelPath: string;
  /** Spoken language, or "auto". */
  language?: string;
  /**
   * Words to expect, comma-separated (names, places, jargon). Whisper gets them as its initial prompt,
   * which roughly halved errors on names in our tests (docs/stt-benchmark.md).
   */
  vocabulary?: string;
  timeoutMs?: number;
  command?: string;
  execFile?: ExecFile;
  fileExists?: (path: string) => boolean;
}

/** Whisper.cpp adapter: runs the local `whisper-cli` binary on a temporary WAV file. */
export function createWhisperStt(options: WhisperOptions): SpeechToText {
  const {
    modelPath,
    language = "en",
    vocabulary = "",
    timeoutMs = 60_000,
    command = "whisper-cli",
    execFile = nodeExecFile as unknown as ExecFile,
    fileExists = existsSync,
  } = options;

  return {
    async transcribe(clip) {
      if (!fileExists(modelPath)) {
        const name = basename(modelPath);
        throw new SttError(
          /^ggml-[\w.-]+\.bin$/.test(name)
            ? `Whisper model not found at "${modelPath}". Download it with: ` +
                `curl -L -o ${modelPath} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${name}`
            : `Whisper model not found at "${modelPath}". Set ATOM_STT_MODEL in .env to a whisper.cpp model ` +
                `file such as models/ggml-base.en.bin (download links: https://huggingface.co/ggerganov/whisper.cpp).`,
        );
      }

      const dir = await mkdtemp(join(tmpdir(), "zeno-stt-"));
      const wavPath = join(dir, "input.wav");
      try {
        await writeFile(wavPath, toWav(clip));
        const stdout = await new Promise<string>((resolve, reject) => {
          execFile(
            command,
            ["-m", modelPath, "-f", wavPath, "-l", language, "-nt", "-np", ...promptArgs(vocabulary)],
            { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
            (error, out, stderr) => {
              if (!error) return resolve(out);
              if (error.code === "ENOENT") {
                return reject(new SttError(`${command} not found. Install it with: brew install whisper-cpp`));
              }
              if (error.killed) return reject(new SttError(`Transcription timed out after ${timeoutMs} ms`));
              const detail = stderr.trim().split("\n").slice(-2).join(" | ");
              reject(new SttError(`Transcription failed (exit code ${error.code}). ${detail}`));
            },
          );
        });
        return cleanTranscript(stdout);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

/** Removes Whisper's non-speech markers (e.g. [BLANK_AUDIO], (music)) and joins lines. */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Wraps mono 16-bit PCM in a WAV header. */
export function toWav(clip: AudioClip): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = clip.sampleRate * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + clip.pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(clip.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(clip.pcm.length, 40);
  return Buffer.concat([header, clip.pcm]);
}

/** Turns a vocabulary list into Whisper's initial-prompt arguments; empty when there is nothing to add. */
export function promptArgs(vocabulary: string): string[] {
  const words = vocabulary
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
  return words.length === 0 ? [] : ["--prompt", `${words.join(", ")}.`];
}
