// Small helpers of the Mac runtime, moved out of runtime.ts without changes: opening the stores, error text for the
// log and the user, voice-loop logging, the voice-only Core, and the date line.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CoreError, type Core } from "@zeno/core";
import { GatewayError } from "@zeno/llm-gateway";
import type { Logger } from "@zeno/shared";
import { openMemoryStore, type MemoryStore } from "@zeno/memory";
import { openHelperStore, type HelperStore } from "@zeno/helpers";
import type { IslandHelpers } from "./island.ts";
import { AudioError } from "./audio.ts";
import { SttError } from "./stt.ts";
import { TtsError } from "./tts.ts";
import type { VoiceLoopEvents } from "./voice-loop.ts";

/** Opens the memory store, or returns undefined (memory off, or the file cannot be opened: ZENO still runs). */
export function openMemory(path: string, log: Logger): MemoryStore | undefined {
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

/**
 * Opens the helper store (ADR-081), or returns undefined if the file cannot be opened (ZENO still runs; the
 * island is told there are no helpers). Every change is logged by ids, state and timing only, never task or report text.
 */
export function openHelpers(path: string, log: Logger, agentsDir?: string, skillsDir?: string, checkpointsDir?: string): HelperStore | undefined {
  try {
    const store = openHelperStore({ path, ...(agentsDir ? { agentsDir } : {}), ...(skillsDir ? { skillsDir } : {}), ...(checkpointsDir ? { checkpointsDir } : {}) });
    store.onChange((change) => log.info("helpers.change", change));
    log.info("helpers.open");
    // ADR-093: a broken data/agents/<id>/soul.md would otherwise just drop that agent; the Board shows these too.
    for (const { id, problem } of store.agentProblems()) log.warn("helpers.agent_problem", { id, problem });
    return store;
  } catch (error) {
    log.error("helpers.unavailable", { ...errorFields(error) });
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
export function createEchoCore(): Core {
  return {
    async handle(input: { text: string }) {
      return { text: `I heard: ${input.text}`, requestId: "voice-only" };
    },
    prepare() {},
  } as unknown as Core;
}

/** The Calendar and Reminders helper: the one the island passes, else a development build. */
export function findCalendarHelper(): string | undefined {
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

/** ADR-083: Laya takes about 5 s to start, so it starts when the ZENO window opens, not on the first job. */
export function warmOnOpen(island: IslandHelpers, decisions: { warm(): void }): IslandHelpers {
  return {
    ...island,
    list: () => {
      decisions.warm();
      return island.list();
    },
  };
}
