import { ConfigError, loadConfig, type Config } from "@zeno/shared";
import { AudioError, listAudioDevices, peakLevel, startRecording, type Recording } from "./audio.ts";
import { SttError, createWhisperStt } from "./stt.ts";

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

console.log(`ZENO Phase 0: started (log level: ${config.log.level})`);
console.log(`Microphone: ${config.audio.inputDevice}`);
console.log("Press Space to start/stop recording, d to list microphones, q to quit.");

let recording: Recording | null = null;
const stt = createWhisperStt({ modelPath: config.stt.modelPath, language: config.stt.language });

function report(error: unknown) {
  if (error instanceof AudioError) console.error(`Audio error: ${error.message}`);
  else if (error instanceof SttError) console.error(`Speech-to-text error: ${error.message}`);
  else console.error(error);
}

async function toggleRecording() {
  if (!recording) {
    recording = startRecording(config.audio, {
      onReady: () => console.log("● Recording… speak now, press Space to stop"),
      onFailure: (error) => {
        recording = null;
        report(error);
      },
    });
    console.log("Opening microphone…");
    return;
  }
  const current = recording;
  recording = null;
  try {
    const clip = await current.stop();
    const peak = Math.round(peakLevel(clip.pcm) * 100);
    console.log(`Recorded ${(clip.durationMs / 1000).toFixed(1)} s (peak level ${peak}%). Transcribing…`);
    const started = Date.now();
    const text = await stt.transcribe(clip);
    const took = ((Date.now() - started) / 1000).toFixed(1);
    console.log(text ? `You said: "${text}" (${took} s)` : `No speech recognized (${took} s)`);
  } catch (error) {
    report(error);
  }
}

function quit() {
  if (recording) void recording.stop().catch(() => {});
  process.exit(0);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("data", (data: Buffer) => {
  const key = data.toString();
  if (key === "q" || key === "\u0003") quit();
  else if (key === " ") void toggleRecording();
  else if (key === "d") void listAudioDevices().then((devices) => console.log(`Microphones: ${devices.join(", ") || "none found"}`));
});
process.stdin.on("end", quit);
