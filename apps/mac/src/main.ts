import { createCore, CoreError } from "@zeno/core";
import { createGateway, createProviderAdapter, GatewayError } from "@zeno/llm-gateway";
import { ConfigError, loadConfig, type Config } from "@zeno/shared";
import { AudioError, listAudioDevices, startRecording } from "./audio.ts";
import { SttError, createWhisperStt } from "./stt.ts";
import { TtsError, createKokoroSynthesizer, createSpeaker } from "./tts.ts";
import { createVoiceLoop, type LoopStage, type LoopState } from "./voice-loop.ts";

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

const debug = config.log.level === "debug";
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

console.log(`ZENO Phase 0: started (log level: ${config.log.level})`);
console.log(`Model: ${config.llm.provider} / ${config.llm.model}`);
console.log(`Microphone: ${config.audio.inputDevice}   Voice: ${config.tts.voice} (Kokoro ${config.tts.dtype})`);
console.log("Space: talk / send / interrupt   Esc: cancel   r: new conversation   t: test voice   d: microphones   q: quit");

// --- Assemble the pipeline: Microphone → Whisper → Core → LLM Gateway → provider → Kokoro → speaker
const stt = createWhisperStt({ modelPath: config.stt.modelPath, language: config.stt.language });
const gateway = createGateway({ provider: createProviderAdapter(config.llm), timeoutMs: config.llm.timeoutMs });
const core = createCore({ model: gateway });
const tts = createSpeaker(createKokoroSynthesizer({ voice: config.tts.voice, dtype: config.tts.dtype }));

const STATE_LABEL: Partial<Record<LoopState, string>> = {
  listening: "Opening microphone…",
  transcribing: "… transcribing",
  thinking: "… thinking",
};

const STAGE_LABEL: Record<LoopStage, string> = {
  microphone: "Microphone",
  transcription: "Speech-to-text",
  model: "Model",
  speech: "Text-to-speech",
};

function describe(error: unknown): string {
  if (error instanceof GatewayError) return `${error.message}${error.retryable ? " (try again in a moment)" : ""}`;
  if (error instanceof AudioError || error instanceof SttError || error instanceof TtsError || error instanceof CoreError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

const loop = createVoiceLoop({
  record: (handlers) => startRecording(config.audio, handlers),
  stt,
  core,
  tts,
  events: {
    onState: (state) => {
      const label = STATE_LABEL[state];
      if (label) console.log(label);
    },
    onMicReady: () => console.log("● Listening… speak now, press Space to send"),
    onTranscript: (text) => console.log(`You:  ${text}`),
    onReply: (text) => console.log(`ZENO: ${text}`),
    onTurnComplete: (t) => {
      if (debug) {
        const sound = t.firstSound === undefined ? "" : `, first sound ${seconds(t.firstSound)}`;
        console.log(`(transcription ${seconds(t.transcription)}, model ${seconds(t.model)}${sound})`);
      }
    },
    onNotice: (message) => console.log(message),
    onError: (stage, error) => console.error(`${STAGE_LABEL[stage]} error: ${describe(error)}`),
  },
});

// Load the voice in the background so the first spoken reply is not delayed.
if (process.stdin.isTTY) {
  const started = Date.now();
  tts.warmUp().then(
    () => console.log(`Voice ready (${seconds(Date.now() - started)}). Press Space and speak.`),
    (error) => console.error(`Text-to-speech error: ${describe(error)}`),
  );
}

let testSpeech: AbortController | null = null;
function testVoice() {
  if (loop.state !== "idle") return;
  testSpeech?.abort();
  const controller = new AbortController();
  testSpeech = controller;
  console.log("Speaking a test sentence…");
  tts
    .speak("Hello, I am ZENO. This is my local voice, running entirely on your Mac.", controller.signal)
    .catch((error) => console.error(`Text-to-speech error: ${describe(error)}`));
}

function quit() {
  testSpeech?.abort();
  loop.cancel();
  // Give the microphone and audio player a moment to release before exiting.
  setTimeout(() => process.exit(0), 100);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("data", (data: Buffer) => {
  const key = data.toString();
  if (key === "q" || key === "\u0003") quit();
  else if (key === " ") {
    testSpeech?.abort();
    loop.press();
  } else if (key === "\u001b") {
    testSpeech?.abort();
    if (loop.state !== "idle") console.log("Cancelled.");
    loop.cancel();
  } else if (key === "r") {
    loop.cancel();
    core.reset();
    console.log("New conversation.");
  } else if (key === "t") testVoice();
  else if (key === "d") {
    void listAudioDevices().then((devices) => console.log(`Microphones: ${devices.join(", ") || "none found"}`));
  }
});
process.stdin.on("end", quit);
