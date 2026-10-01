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

/**
 * Turns ffmpeg's output into a message that says what to do. The common causes are recognised;
 * anything else keeps ffmpeg's last line so nothing is hidden.
 */
export function describeFailure(device: string, code: number | null, stderr: string): string {
  const lines = stderr.trim().split("\n").map((l) => l.replace(/^\[[^\]]+\]\s*/, "").trim()).filter(Boolean);
  const all = lines.join(" ");
  const pick = 'Run "pnpm start" and press d to list microphones, then set ZENO_AUDIO_INPUT_DEVICE in .env (for example ":1").';
  if (/not authorized|permission|denied|TCC/i.test(all)) {
    return `ZENO is not allowed to use the microphone. Allow your terminal app in System Settings → Privacy & Security → Microphone, then restart it.`;
  }
  if (/Input\/output error|Invalid device index|not find|No such/i.test(all)) {
    return `Microphone "${device}" is not available (it may be unplugged or the number may be wrong). ${pick}`;
  }
  const exit = code === null ? "" : ` (exit code ${code})`;
  const last = lines.at(-1);
  return `Microphone "${device}" stopped${exit}${last ? `: ${last}` : ""}. Check that it is connected; if the problem continues, ${pick.charAt(0).toLowerCase()}${pick.slice(1)}`;
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
