import { createCore, CoreError } from "@zeno/core";
import { createGateway, createProviderAdapter, GatewayError } from "@zeno/llm-gateway";
import { ConfigError, createLogger, loadConfig, type Config, type Logger } from "@zeno/shared";
import { AudioError, defaultInputDevice, listAudioDevices, startRecording } from "./audio.ts";
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
const log: Logger = createLogger({ level: config.log.level, file: config.log.file });
log.info("app.start", { provider: config.llm.provider, model: config.llm.model, voice: config.tts.voice, microphone: config.audio.inputDevice });

// Last line of defence: an unexpected bug is logged and explained instead of a bare stack trace.
const crash = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log.error("app.crash", { message, stack: error instanceof Error ? error.stack : undefined });
  console.error(`ZENO stopped because of an unexpected error: ${message}\nDetails are in ${config.log.file}.`);
  process.exit(1);
};
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

console.log(`ZENO Phase 0: started (log level: ${config.log.level})`);
console.log(`Model: ${config.llm.provider} / ${config.llm.model}`);
console.log(`Microphone: ${config.audio.inputDevice}   Voice: ${config.tts.voice} (Kokoro ${config.tts.dtype})`);

/** The microphone actually in use: with ":default" this follows macOS, which changes when devices are plugged in. */
async function micName(): Promise<string> {
  if (config.audio.inputDevice !== ":default") return config.audio.inputDevice;
  const name = await defaultInputDevice();
  return name ? `macOS default: ${name}` : "macOS default";
}
void micName().then((name) => {
  if (config.audio.inputDevice === ":default") console.log(`Using microphone: ${name.replace("macOS default: ", "")}`);
});
console.log("Space: talk / send / interrupt   Esc: cancel   r: new conversation   t: test voice   d: microphones   q: quit");

// --- Assemble the pipeline: Microphone → Whisper → Core → LLM Gateway → provider → Kokoro → speaker
const stt = createWhisperStt({
  modelPath: config.stt.modelPath,
  language: config.stt.language,
  vocabulary: config.stt.vocabulary,
});
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

/** Machine-readable error details for the log (messages are already free of credentials). */
function errorFields(error: unknown) {
  return {
    error: error instanceof Error ? error.name : typeof error,
    kind: error instanceof GatewayError ? error.kind : undefined,
    retryable: error instanceof GatewayError ? error.retryable : undefined,
    message: error instanceof Error ? error.message : String(error),
  };
}

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
    onMicSilent: () => {
      void micName().then((name) => {
        log.warn("mic.silent", { microphone: name });
        console.log(
          `  The microphone (${name}) is hearing nothing. If you are speaking, ZENO is listening to the wrong ` +
            `device: press d to list microphones, then set ZENO_AUDIO_INPUT_DEVICE in .env to one by name ` +
            `(e.g. ":Webcam internal mic") and restart.`,
        );
      });
    },
    onTranscript: (text) => console.log(`You:  ${text}`),
    onReply: (text) => console.log(`ZENO: ${text}`),
    onTurnComplete: (t) => {
      log.info("turn.complete", {
        requestId: t.requestId,
        speechMs: t.speechMs,
        transcriptionMs: t.transcription,
        modelMs: t.model,
        firstSoundMs: t.firstSound,
      });
      if (debug) {
        const sound = t.firstSound === undefined ? "" : `, first sound ${seconds(t.firstSound)}`;
        console.log(`(transcription ${seconds(t.transcription)}, model ${seconds(t.model)}${sound})`);
      }
    },
    onNotice: (message) => {
      log.info("turn.skipped", { reason: message });
      console.log(message);
    },
    onError: (stage, error) => {
      log.error("turn.failed", { stage, ...errorFields(error) });
      console.error(`${STAGE_LABEL[stage]} error: ${describe(error)}`);
    },
  },
});

// Load the voice in the background so the first spoken reply is not delayed.
if (process.stdin.isTTY) {
  const started = Date.now();
  tts.warmUp().then(
    () => {
      log.info("tts.ready", { ms: Date.now() - started });
      console.log(`Voice ready (${seconds(Date.now() - started)}). Press Space and speak.`);
    },
    (error) => {
      log.error("tts.load_failed", errorFields(error));
      console.error(`Text-to-speech error: ${describe(error)}`);
    },
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
  log.info("app.quit");
  testSpeech?.abort();
  loop.cancel();
  tts.close();
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
    void Promise.all([listAudioDevices(), micName()]).then(([devices, name]) => {
      console.log(`Microphones: ${devices.join(", ") || "none found"}`);
      console.log(`In use: ${name}. To choose one, set ZENO_AUDIO_INPUT_DEVICE in .env to its name with a colon, e.g. ":${devices.at(-1) ?? "name"}", then restart.`);
    });
  }
});
process.stdin.on("end", quit);
