// The parts of the Mac runtime shared by both interfaces (terminal and island):
// Microphone → Whisper → ZENO Core → LLM Gateway → provider → Kokoro → speaker.

import { createCore, CoreError, type Core } from "@zeno/core";
import { createGateway, createProviderAdapter, createSwitchableModel, GatewayError } from "@zeno/llm-gateway";
import { createLogger, type Config, type LlmChoice, type Logger, type ProviderKeys } from "@zeno/shared";
import { AudioError, defaultInputDevice, startRecording } from "./audio.ts";
import { SttError, createWhisperStt, type SpeechToText } from "./stt.ts";
import { createModelSettings, writeSavedChoice, type ModelSettings } from "./model-settings.ts";
import { TtsError, createKokoroSynthesizer, createSpeaker, type TextToSpeech } from "./tts.ts";
import type { VoiceLoopEvents, VoiceLoopOptions } from "./voice-loop.ts";

export interface Runtime {
  config: Config;
  log: Logger;
  core: Core;
  /** The AI provider and model in use, switchable while running (island `model.set`). */
  settings: ModelSettings;
  stt: SpeechToText;
  tts: TextToSpeech;
  record: VoiceLoopOptions["record"];
  /** The microphone actually in use: with ":default" this follows macOS, which changes when devices are plugged in. */
  micName(): Promise<string>;
}

export interface RuntimeOptions {
  /** Every provider key in .env, so the model can be switched to any of them. Default: the configured one only. */
  keys?: ProviderKeys;
  /** Where a model switch is saved (config/island.json). */
  settingsPath?: string;
}

export function createRuntime(
  config: Config,
  log: Logger = createLogger({ level: config.log.level, file: config.log.file }),
  options: RuntimeOptions = {},
): Runtime {
  const stt = createWhisperStt({
    modelPath: config.stt.modelPath,
    language: config.stt.language,
    vocabulary: config.stt.vocabulary,
  });
  const createModel = (choice: LlmChoice, apiKey: string) =>
    createGateway({ provider: createProviderAdapter({ ...choice, apiKey }), timeoutMs: config.llm.timeoutMs });
  const initial = { provider: config.llm.provider, model: config.llm.model };
  const model = createSwitchableModel(createModel(initial, config.llm.apiKey));
  const core = createCore({ model });
  const settingsPath = options.settingsPath;
  const settings = createModelSettings({
    initial,
    keys: { ...options.keys, [config.llm.provider]: config.llm.apiKey },
    model,
    createModel,
    save: (choice) => {
      if (settingsPath) writeSavedChoice(settingsPath, choice);
    },
    log,
  });
  const tts = createSpeaker(createKokoroSynthesizer({ voice: config.tts.voice, dtype: config.tts.dtype }));
  return {
    config,
    log,
    core,
    settings,
    stt,
    tts,
    record: (handlers) => startRecording(config.audio, handlers),
    async micName() {
      if (config.audio.inputDevice !== ":default") return config.audio.inputDevice;
      const name = await defaultInputDevice();
      return name ? `macOS default: ${name}` : "macOS default";
    },
  };
}

/** Machine-readable error details for the log (messages are already free of credentials). */
export function errorFields(error: unknown) {
  return {
    error: error instanceof Error ? error.name : typeof error,
    kind: error instanceof GatewayError ? error.kind : undefined,
    retryable: error instanceof GatewayError ? error.retryable : undefined,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** A plain-language description of an error for the user. */
export function describe(error: unknown): string {
  if (error instanceof GatewayError) return `${error.message}${error.retryable ? " (try again in a moment)" : ""}`;
  if (error instanceof AudioError || error instanceof SttError || error instanceof TtsError || error instanceof CoreError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Adds operational logging to an interface's voice-loop events. The log records timings, stages and
 * error kinds, never what was said or replied (SECURITY.md).
 */
export function withLogging(log: Logger, micName: () => Promise<string>, events: VoiceLoopEvents): VoiceLoopEvents {
  return {
    ...events,
    onMicSilent: () => {
      void micName().then((microphone) => log.warn("mic.silent", { microphone }));
      events.onMicSilent?.();
    },
    onTurnComplete: (t) => {
      log.info("turn.complete", {
        requestId: t.requestId,
        speechMs: t.speechMs,
        transcriptionMs: t.transcription,
        modelMs: t.model,
        firstSoundMs: t.firstSound,
      });
      events.onTurnComplete?.(t);
    },
    onNotice: (notice) => {
      log.info("turn.skipped", { reason: notice.kind, loudest: notice.kind === "no_speech" ? notice.loudest : undefined });
      events.onNotice?.(notice);
    },
    onError: (stage, error) => {
      log.error("turn.failed", { stage, ...errorFields(error) });
      events.onError?.(stage, error);
    },
  };
}
