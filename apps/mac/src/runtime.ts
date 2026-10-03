// The parts of the Mac runtime shared by both interfaces (terminal and island):
// Microphone → Whisper → ZENO Core → LLM Gateway → provider → Kokoro → speaker.

import { createCore, CoreError, type Core } from "@zeno/core";
import { createComputerBridge, type ComputerBridge } from "./computer-bridge.ts";
import { createComputerTool, createCuaTransport, createToolEngine, timeTool } from "@zeno/tool-engine";
import { createGateway, createProviderAdapter, createSwitchableModel, GatewayError } from "@zeno/llm-gateway";
import { createLogger, type Config, type LlmChoice, type Logger, type ProviderKeys } from "@zeno/shared";
import { createMemoryTools, DEFAULT_MAX_MEMORIES, memoryContext, openMemoryStore, type MemoryStore } from "@zeno/memory";
import type { InputSource } from "@zeno/contracts";
import type { IslandMemory } from "./island.ts";
import { AudioError, defaultInputDevice, startRecording } from "./audio.ts";
import { SttError, createWhisperStt, type SpeechToText } from "./stt.ts";
import { createModelSettings, writeSavedChoice, type ModelSettings } from "./model-settings.ts";
import { TtsError, createKokoroSynthesizer, createSpeaker, type TextToSpeech } from "./tts.ts";
import type { VoiceLoopEvents, VoiceLoopOptions } from "./voice-loop.ts";

/** One request on the plan provider can take several tool turns, each a model call; this is its whole-request limit. */
const PLAN_TIMEOUT_MS = 120_000;

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
  /** Computer control's link to the island (steps and approvals). Used only when ZENO_COMPUTER=1. */
  computer: ComputerBridge;
  /** What the user asked ZENO to keep (ADR-058). Undefined when ZENO_MEMORY=0 or the store could not open. */
  memory?: MemoryStore;
  /** The memory as Settings sees it (list, forget, clear, change updates). Undefined when memory is off. */
  islandMemory?: IslandMemory;
}

export interface RuntimeOptions {
  /** Every provider key in .env, so the model can be switched to any of them. Default: the configured one only. */
  keys?: ProviderKeys;
  /** Where a model switch is saved (config/island.json). */
  settingsPath?: string;
  /** The memory file (ADR-058). Default: ZENO_MEMORY_FILE or data/memory.db; ":memory:" for tests. */
  memoryPath?: string;
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
  const computer = createComputerBridge();
  const memory = openMemory(options.memoryPath ?? process.env.ZENO_MEMORY_FILE ?? "data/memory.db", log);
  // The request a memory tool is running for, for provenance. Set by the Core's context hook, which runs first.
  let current: { source: InputSource; requestId?: string } = { source: "voice" };
  const memoryListeners = new Set<() => void>();
  const islandMemory: IslandMemory | undefined = memory && {
    list: () => memory.recent(DEFAULT_MAX_MEMORIES).map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt.toISOString(), source: m.source })),
    count: () => memory.count(),
    forget: (id) => memory.remove(id),
    clear: () => memory.clear(),
    onChange: (listener) => {
      memoryListeners.add(listener);
      return () => memoryListeners.delete(listener);
    },
  };
  // The tools ZENO can use. Built before the model because "Claude (my plan)" runs the tool loop itself and
  // needs them; the other providers get them from the Core.
  const toolEngine = createToolEngine({
    tools: [
      timeTool(),
      ...(memory
        ? createMemoryTools({
            store: memory,
            provenance: () => current,
            onChange: (e) => {
              log.info("memory.change", e);
              for (const listener of memoryListeners) listener();
            },
          })
        : []),
      // ADR-054: off unless ZENO_COMPUTER=1. Steps and approvals go through the bridge to the island;
      // with no island, or no answer, an approval is a refusal.
      ...(process.env.ZENO_COMPUTER === "1"
        ? [
            createComputerTool({
              cua: createCuaTransport(),
              approve: (request, signal) => {
                log.info("computer.approval_asked");
                return computer.approve(request, signal);
              },
              onStep: (step) => computer.step(step),
              onPoint: (target) => computer.point(target),
              onAction: (event) => log.info("computer.action", { ...event }),
            }),
          ]
        : []),
    ],
    onCall: (e) => log.info("tool.call", e),
  });
  const createModel = (choice: LlmChoice, apiKey: string) =>
    createGateway({
      provider: createProviderAdapter({
        ...choice,
        apiKey,
        tools: toolEngine,
        // Plan use goes in the log so it is visible how much of the plan a day of ZENO takes. No keys, no text.
        onUsage: (usage) => log.info("plan.usage", { ...usage }),
      }),
      // Claude Code starts its own process and may take several tool turns, so it gets longer than one API call.
      timeoutMs: choice.provider === "claude-plan" ? Math.max(config.llm.timeoutMs, PLAN_TIMEOUT_MS) : config.llm.timeoutMs,
    });
  const initial = { provider: config.llm.provider, model: config.llm.model };
  const model = createSwitchableModel(createModel(initial, config.llm.apiKey));
  // ZENO_VOICE_ONLY=1: test speech in and out without the AI. ZENO reads back what Whisper heard, and no
  // request is made to any model. (Typed as `Core` so every caller treats it the same.)
  const core: Core = process.env.ZENO_VOICE_ONLY === "1" ? createEchoCore() : createCore({
        model,
        tools: toolEngine,
        context: (input, context) => {
          current = { source: input.source, requestId: context.requestId };
          if (!memory) return undefined;
          const block = memoryContext(input.text, { store: memory });
          log.debug("memory.context", { requestId: context.requestId, kept: memory.count(), used: block ? block.split("\n").length - 1 : 0 });
          return block;
        },
      });
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
    computer,
    ...(memory ? { memory, islandMemory } : {}),
    record: (handlers) => startRecording(config.audio, handlers),
    async micName() {
      if (config.audio.inputDevice !== ":default") return config.audio.inputDevice;
      const name = await defaultInputDevice();
      return name ? `macOS default: ${name}` : "macOS default";
    },
  };
}

/** Opens the memory store, or returns undefined (memory off, or the file cannot be opened: ZENO still runs). */
function openMemory(path: string, log: Logger): MemoryStore | undefined {
  if (process.env.ZENO_MEMORY === "0") return undefined;
  try {
    const store = openMemoryStore({ path });
    log.info("memory.open", { kept: store.count() });
    return store;
  } catch (error) {
    log.error("memory.unavailable", { ...errorFields(error) });
    return undefined;
  }
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

/** A stand-in for ZENO Core that replies with the words it was given, for testing the voice parts alone. */
function createEchoCore(): Core {
  return {
    async handle(input: { text: string }) {
      return { text: `I heard: ${input.text}`, requestId: "voice-only" };
    },
  } as unknown as Core;
}
