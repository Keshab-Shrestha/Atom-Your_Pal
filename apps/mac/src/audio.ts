import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

export interface AudioSettings {
  inputDevice: string;
  sampleRate: number;
}

/** Mono, signed 16-bit little-endian PCM. */
export interface AudioClip {
  pcm: Buffer;
  sampleRate: number;
  durationMs: number;
}

export interface Recording {
  /** Stops capture and returns the recorded audio. */
  stop(): Promise<AudioClip>;
}

export interface RecorderOptions {
  /** Called once when the first audio arrives, i.e. the microphone is actually capturing. */
  onReady?: () => void;
  /** Called if capture fails before stop() is requested (e.g. ffmpeg missing, device unavailable). */
  onFailure?: (error: AudioError) => void;
  spawn?: (command: string, args: string[]) => ChildProcess;
  command?: string;
  /** How long to wait for ffmpeg to exit after an interrupt before killing it. */
  stopTimeoutMs?: number;
}

export class AudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioError";
  }
}

const BYTES_PER_SAMPLE = 2;

/**
 * Starts capturing microphone audio with ffmpeg (AVFoundation) as mono 16-bit PCM.
 * Capture continues until stop() is called.
 */
export function startRecording(settings: AudioSettings, options: RecorderOptions = {}): Recording {
  const { spawn = nodeSpawn, command = "ffmpeg", stopTimeoutMs = 2000, onFailure, onReady } = options;

  const child = spawn(command, [
    "-hide_banner",
    "-loglevel", "error",
    "-f", "avfoundation",
    "-i", settings.inputDevice,
    "-ac", "1",
    "-ar", String(settings.sampleRate),
    "-f", "s16le",
    "pipe:1",
  ]);

  const chunks: Buffer[] = [];
  let stderr = "";
  let stopping = false;
  let failure: AudioError | null = null;

  child.stdout?.on("data", (chunk: Buffer) => {
    if (chunks.length === 0) onReady?.();
    chunks.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));

  const fail = (error: AudioError) => {
    if (failure) return;
    failure = error;
    onFailure?.(error);
  };

  child.once("error", (error: NodeJS.ErrnoException) => {
    fail(
      error.code === "ENOENT"
        ? new AudioError(`${command} not found. Install it with: brew install ffmpeg`)
        : new AudioError(`Could not start ${command}: ${error.message}`),
    );
  });

  child.once("close", (code) => {
    if (!stopping) fail(new AudioError(describeFailure(settings.inputDevice, code, stderr)));
  });

  return {
    async stop() {
      if (failure) throw failure;
      stopping = true;
      child.kill("SIGINT");
      const timer = setTimeout(() => child.kill("SIGKILL"), stopTimeoutMs);
      await closed;
      clearTimeout(timer);

      const pcm = Buffer.concat(chunks);
      const usable = pcm.subarray(0, pcm.length - (pcm.length % BYTES_PER_SAMPLE));
      if (usable.length === 0) {
        throw new AudioError(`No audio captured. ${describeFailure(settings.inputDevice, null, stderr)}`);
      }
      return {
        pcm: usable,
        sampleRate: settings.sampleRate,
        durationMs: Math.round((usable.length / BYTES_PER_SAMPLE / settings.sampleRate) * 1000),
      };
    },
  };
}

function describeFailure(device: string, code: number | null, stderr: string): string {
  const detail = stderr.trim().split("\n").slice(-3).join(" | ");
  const exit = code === null ? "" : ` (exit code ${code})`;
  return `Microphone "${device}" failed${exit}.${detail ? ` ffmpeg: ${detail}.` : ""} Check the device name and microphone permission.`;
}

/** Parses the audio input device names from `ffmpeg -f avfoundation -list_devices true -i ""` output. */
export function parseAudioDevices(ffmpegOutput: string): string[] {
  const devices: string[] = [];
  let inAudio = false;
  for (const line of ffmpegOutput.split("\n")) {
    if (line.includes("AVFoundation audio devices:")) inAudio = true;
    else if (line.includes("AVFoundation video devices:")) inAudio = false;
    else if (inAudio) {
      const match = line.match(/\] \[(\d+)\] (.+)$/);
      if (match) devices.push(match[2].trim());
    }
  }
  return devices;
}

/** Lists available microphones. Returns an empty list if ffmpeg is unavailable. */
export function listAudioDevices(command = "ffmpeg"): Promise<string[]> {
  return new Promise((resolve) => {
    const child = nodeSpawn(command, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]);
    let output = "";
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.once("error", () => resolve([]));
    child.once("close", () => resolve(parseAudioDevices(output)));
  });
}

/** Peak absolute level of 16-bit PCM, from 0 (silence) to 1 (full scale). */
export function peakLevel(pcm: Buffer): number {
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += BYTES_PER_SAMPLE) {
    peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  }
  return peak / 32768;
}
