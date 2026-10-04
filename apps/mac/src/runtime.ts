// The parts of the Mac runtime shared by both interfaces (terminal and island):
// Microphone → Whisper → ZENO Core → LLM Gateway → provider → Kokoro → speaker.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCore, CoreError, type Core } from "@zeno/core";
import { createComputerBridge, type ComputerBridge } from "./computer-bridge.ts";
import {
  calendarRunner,
  createCalendarTools,
  createComputerTool,
  createCuaTransport,
  createTimers,
  createAppTools,
  createToolEngine,
  timeTool,
  weatherTool,
  type TimerInfo,
  type Timers,
} from "@zeno/tool-engine";
import { createGateway, createProviderAdapter, createSwitchableModel, GatewayError } from "@zeno/llm-gateway";
import { createLogger, type Config, type LlmChoice, type Logger, type ProviderKeys } from "@zeno/shared";
import {
  createEpisodeRecorder,
  createMemoryTools,
  DEFAULT_MAX_EPISODES,
  DEFAULT_MAX_MEMORIES,
  episodeContext,
  MEMORY_GUIDANCE,
  memoryContext,
  openMemoryStore,
  type EpisodeRecorder,
  type MemoryStore,
} from "@zeno/memory";
import type { InputSource, Message } from "@zeno/contracts";
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
  /** Countdown timers (ADR-061). */
  timers: Timers;
  /** Called when a timer ends; returns a function that stops listening. */
  onTimer(listener: (timer: TimerInfo) => void): () => void;
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
    episodes: () => memory.episodes(DEFAULT_MAX_EPISODES).map((e) => ({ id: e.id, summary: e.summary, endedAt: e.endedAt.toISOString(), exchanges: e.exchanges })),
    forgetEpisode: (id) => memory.removeEpisode(id),
    clearEpisodes: () => memory.clearEpisodes(),
    onChange: (listener) => {
      memoryListeners.add(listener);
      return () => memoryListeners.delete(listener);
    },
  };
  const timerListeners = new Set<(timer: TimerInfo) => void>();
  const timers = createTimers({
    onFire: (timer) => {
      log.info("timer.fired", { id: timer.id, seconds: timer.seconds });
      for (const listener of timerListeners) listener(timer);
    },
  });
  // ADR-062: Open-Meteo, no key. ZENO_WEATHER=0 turns it off; ZENO_HOME sets "here" (default: the time zone's city).
  // Home's forecast is fetched at start and every 30 minutes, so "what's the weather" needs no network wait.
  const weather = process.env.ZENO_WEATHER === "0" ? undefined : weatherTool(process.env.ZENO_HOME ? { home: () => process.env.ZENO_HOME! } : {});
  if (weather) {
    void weather.warm();
    setInterval(() => void weather.warm(), 30 * 60_000).unref();
  }
  const calendarHelper = findCalendarHelper();
  log.info("calendar.helper", { available: Boolean(calendarHelper) });
  // The tools ZENO can use. Built before the model because "Claude (my plan)" runs the tool loop itself and
  // needs them; the other providers get them from the Core.
  const toolEngine = createToolEngine({
    tools: [
      timeTool(),
      // ADR-066: open apps and web pages. Always on: no screen access, no clicks. ZENO_APPS=0 turns it off.
      ...(process.env.ZENO_APPS === "0" ? [] : createAppTools()),
      ...timers.tools,
      // ADR-062: Open-Meteo, no key. ZENO_WEATHER=0 turns it off; ZENO_HOME sets "here" (default: the time zone's city).
      ...(weather ? [weather] : []),
      // ADR-060: Calendar and Reminders when the helper is there (inside ZENO.app). ZENO_CALENDAR=0 turns it off.
      ...(calendarHelper ? createCalendarTools({ run: calendarRunner(calendarHelper) }) : []),
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
  // ADR-059: a short summary of each conversation, written in the background with the same model (no tools).
  const episodes: EpisodeRecorder | undefined =
    memory && process.env.ZENO_EPISODES !== "0"
      ? createEpisodeRecorder({
          store: memory,
          model,
          onSaved: (e) => {
            log.info("episode.saved", e);
            for (const listener of memoryListeners) listener();
          },
          onError: (error) => log.warn("episode.failed", { ...errorFields(error) }),
        })
      : undefined;
  // ZENO_VOICE_ONLY=1: test speech in and out without the AI. ZENO reads back what Whisper heard, and no
  // request is made to any model. (Typed as `Core` so every caller treats it the same.)
  const core: Core = process.env.ZENO_VOICE_ONLY === "1" ? createEchoCore() : createCore({
        model,
        tools: toolEngine,
        context: (input, context) => {
          current = { source: input.source, requestId: context.requestId };
          if (!memory) return nowLine();
          const facts = memoryContext(input.text, { store: memory });
          const past = episodes ? episodeContext(memory, context.sessionId) : undefined;
          log.debug("memory.context", {
            requestId: context.requestId,
            kept: memory.count(),
            used: facts ? facts.split("\n").length - 1 : 0,
            episodes: past ? past.split("\n").length - 1 : 0,
          });
          return [nowLine(), MEMORY_GUIDANCE, facts, past].filter(Boolean).join("\n\n");
        },
        ...(episodes ? { onExchange: (sessionId: string, turns: readonly Message[]) => episodes.update(sessionId, turns) } : {}),
      });
  // ADR-064: start the model up now (the Claude plan pre-starts Claude Code), and again after a model switch.
  core.prepare();
  const settingsPath = options.settingsPath;
  const settings = createModelSettings({
    initial,
    keys: { ...options.keys, [config.llm.provider]: config.llm.apiKey },
    model,
    createModel: (choice, apiKey) => {
      const next = createModel(choice, apiKey);
      queueMicrotask(() => core.prepare()); // runs once the switch has put `next` in place
      return next;
    },
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
    timers,
    onTimer(listener) {
      timerListeners.add(listener);
      return () => timerListeners.delete(listener);
    },
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
    prepare() {},
  } as unknown as Core;
}

/** The Calendar and Reminders helper: the one the island passes, else a development build. */
function findCalendarHelper(): string | undefined {
  if (process.env.ZENO_CALENDAR === "0") return undefined;
  const candidates = [
    process.env.ZENO_CALENDAR_HELPER,
    fileURLToPath(new URL("../island/build/ZENO.app/Contents/MacOS/zeno-calendar", import.meta.url)),
  ];
  return candidates.find((p): p is string => Boolean(p) && existsSync(p!));
}

/** The date, time and zone, so the model can turn "tomorrow at 3" into a real time for the calendar tools. */
export function nowLine(now = new Date()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const minutes = -now.getTimezoneOffset();
  const offset = `${minutes >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
  const text = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short" }).format(now);
  return `It is now ${text} (${zone}, UTC${offset}).`;
}
