// The terminal interface (`pnpm start`): Space to talk, keys for the other controls.

import { listAudioDevices } from "./audio.ts";
import { describe, errorFields, seconds, withLogging, type Runtime } from "./runtime.ts";
import { createVoiceLoop, type LoopNotice, type LoopStage, type LoopState } from "./voice-loop.ts";

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

export function noticeText(notice: LoopNotice): string {
  switch (notice.kind) {
    case "too_short":
      return "Too short. Press Space, speak, then press Space again to send.";
    case "mic_starting":
      return `The microphone was still starting. Wait for "Listening… speak now", then speak.`;
    case "no_speech":
      return (
        `No speech recognized (loudest sound ${notice.loudest}). Speak close to the microphone; ` +
        `if this keeps happening, press d to check which microphone ZENO is using.`
      );
  }
}

export function runTerminal(runtime: Runtime, onQuit: () => void): void {
  const { config, log, core, tts, micName } = runtime;
  const debug = config.log.level === "debug";

  console.log(`ZENO: started (log level: ${config.log.level})`);
  console.log(`Model: ${config.llm.provider} / ${config.llm.model}`);
  console.log(`Microphone: ${config.audio.inputDevice}   Voice: ${config.tts.voice} (Kokoro ${config.tts.dtype})`);
  void micName().then((name) => {
    if (config.audio.inputDevice === ":default") console.log(`Using microphone: ${name.replace("macOS default: ", "")}`);
  });
  console.log("Space: talk / send / interrupt   Esc: cancel   r: new conversation   t: test voice   d: microphones   q: quit");

  const loop = createVoiceLoop({
    record: runtime.record,
    stt: runtime.stt,
    core,
    tts,
    events: withLogging(log, micName, {
      onState: (state) => {
        const label = STATE_LABEL[state];
        if (label) console.log(label);
      },
      onMicReady: () => console.log("● Listening… speak now, press Space to send"),
      onMicSilent: () => {
        void micName().then((name) => {
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
        if (!debug) return;
        const sound = t.firstSound === undefined ? "" : `, first sound ${seconds(t.firstSound)}`;
        console.log(`(transcription ${seconds(t.transcription)}, model ${seconds(t.model)}${sound})`);
      },
      onNotice: (notice) => console.log(noticeText(notice)),
      onError: (stage, error) => console.error(`${STAGE_LABEL[stage]} error: ${describe(error)}`),
    }),
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

  let quitting = false;
  function quit() {
    if (quitting) return;
    quitting = true;
    log.info("app.quit");
    testSpeech?.abort();
    loop.cancel();
    tts.close();
    onQuit();
  }
  process.on("SIGTERM", quit);

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
        console.log(
          `In use: ${name}. To choose one, set ZENO_AUDIO_INPUT_DEVICE in .env to its name with a colon, ` +
            `e.g. ":${devices.at(-1) ?? "name"}", then restart.`,
        );
      });
    }
  });
  process.stdin.on("end", quit);
}
