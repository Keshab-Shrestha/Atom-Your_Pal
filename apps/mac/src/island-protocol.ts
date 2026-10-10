// The messages between ZENO Island (Swift) and this runtime: JSON lines over stdin / stdout.
// The specification is docs/island-protocol.md; keep the two in step.

import type { Capability } from "@zeno/tool-engine";
import type { LoopState } from "./voice-loop.ts";

export const PROTOCOL_VERSION = 1;

/** Longest command line accepted, in characters. Commands are tiny; anything bigger is a bug or abuse. */
export const MAX_COMMAND_LENGTH = 4096;

export type IslandCommand =
  | { type: "talk.start" }
  | { type: "talk.send" }
  | { type: "talk.cancel" }
  | { type: "conversation.reset" }
  | { type: "model.set"; provider: string; model: string }
  | { type: "approval.answer"; id: string; approved: boolean }
  | { type: "memory.list" }
  | { type: "memory.forget"; id: number }
  | { type: "memory.clear" }
  | { type: "text.send"; text: string }
  | { type: "episode.forget"; id: number }
  | { type: "episode.clear" }
  | { type: "context.window"; bundleId: string; name: string }
  | { type: "quit" };

export type ErrorStage =
  | "microphone"
  | "transcription"
  | "model"
  | "speech"
  | "config"
  | "protocol"
  | "settings"
  | "runtime";
export type NoticeKind = "too_short" | "mic_starting" | "no_speech";

/** The model in use and the choices offered (docs/island-protocol.md, "Model choice"). Never carries API keys. */
export interface InfoEvent {
  type: "info";
  provider: string;
  model: string;
  providers: { id: string; name: string; available: boolean; models: { id: string; name: string }[] }[];
}

/** One kept memory, for Settings (ADR-058). Travels only over the private pipe; never logged. */
export interface MemoryItem {
  id: number;
  text: string;
  /** ISO 8601. */
  createdAt: string;
  source: "voice" | "text";
}

/** One conversation summary (ADR-059). Travels only over the private pipe; never logged. */
export interface EpisodeItem {
  id: number;
  summary: string;
  /** ISO 8601: when the conversation was last summarised. */
  endedAt: string;
  exchanges: number;
}

/** Claude plan usage (ADR-076): the share of each window used, 0.42 = 42%. Each field only when the SDK sent a sane one. */
export interface PlanUsageEvent {
  type: "plan.usage";
  fiveHour?: number;
  sevenDay?: number;
  overage?: boolean;
}

export type IslandEvent =
  | { type: "ready"; protocol: number; provider: string; model: string; microphone: string; voice: boolean }
  | { type: "state"; state: LoopState }
  | { type: "mic.ready" }
  | { type: "mic.level"; peak: number }
  | { type: "mic.silent"; microphone: string }
  | { type: "transcript"; text: string }
  | { type: "reply"; text: string }
  | {
      type: "turn.complete";
      speechMs: number;
      transcriptionMs: number;
      modelMs: number;
      firstSoundMs?: number;
      requestId?: string;
    }
  | { type: "notice"; kind: NoticeKind; message: string }
  | { type: "conversation.reset" }
  | { type: "computer.step"; text: string }
  | { type: "computer.point"; x: number; y: number; w: number; h: number; label: string }
  | { type: "settings.open" }
  | { type: "media.key"; key: "playpause" }
  | { type: "approval.request"; id: string; summary: string; reason: string }
  | { type: "approval.closed"; id: string }
  | InfoEvent
  | { type: "timer"; id: number; label: string; message: string }
  | { type: "context.ready"; app: string; ok: true }
  | { type: "context.ready"; app: string; ok: false; message: string }
  | { type: "capabilities"; items: Capability[] }
  | PlanUsageEvent
  | { type: "memory"; enabled: boolean; count: number; memories: MemoryItem[]; episodes: EpisodeItem[] }
  | { type: "error"; stage: ErrorStage; message: string; kind?: string; retryable?: boolean };

const COMMANDS = new Set<IslandCommand["type"]>([
  "talk.start",
  "talk.send",
  "talk.cancel",
  "conversation.reset",
  "model.set",
  "approval.answer",
  "memory.list",
  "memory.forget",
  "memory.clear",
  "text.send",
  "episode.forget",
  "episode.clear",
  "context.window",
  "quit",
]);

export type ParsedLine = { command: IslandCommand } | { error: string } | { blank: true };

/** Parses one line from the island. Never throws: a bad line becomes an error to report. */
export function parseCommand(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === "") return { blank: true };
  if (trimmed.length > MAX_COMMAND_LENGTH) return { error: `Command too long (${trimmed.length} characters, limit ${MAX_COMMAND_LENGTH}).` };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { error: "Command is not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "Command must be a JSON object." };
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return { error: 'Command has no "type".' };
  if (!COMMANDS.has(type as IslandCommand["type"])) return { error: `Unknown command "${type.slice(0, 40)}".` };
  if (type === "model.set") {
    const { provider, model } = value as { provider?: unknown; model?: unknown };
    if (typeof provider !== "string") return { error: 'model.set needs a "provider" string.' };
    if (typeof model !== "string") return { error: 'model.set needs a "model" string.' };
    return { command: { type, provider, model } };
  }
  if (type === "approval.answer") {
    const { id, approved } = value as { id?: unknown; approved?: unknown };
    if (typeof id !== "string" || id === "") return { error: 'approval.answer needs an "id" string.' };
    if (typeof approved !== "boolean") return { error: 'approval.answer needs "approved" to be true or false.' };
    return { command: { type, id, approved } };
  }
  if (type === "text.send") {
    const { text } = value as { text?: unknown };
    if (typeof text !== "string" || !text.trim()) return { error: 'text.send needs a non-empty "text".' };
    if (text.length > 4000) return { error: "text.send: the text is longer than 4000 characters." };
    return { command: { type, text } };
  }
  if (type === "context.window") {
    const { bundleId, name } = value as { bundleId?: unknown; name?: unknown };
    const ok = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= 200;
    if (!ok(bundleId) || !ok(name)) return { error: 'context.window needs "bundleId" and "name" strings (1 to 200 characters).' };
    return { command: { type, bundleId, name } };
  }
  if (type === "memory.forget" || type === "episode.forget") {
    const { id } = value as { id?: unknown };
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return { error: `${type} needs an "id" that is a whole number.` };
    return { command: { type, id } };
  }
  return { command: { type } as IslandCommand }; // extra fields are ignored (forward compatibility)
}

/** One event as a single line of JSON, ending with a newline. */
export function encodeEvent(event: IslandEvent): string {
  return `${JSON.stringify(event)}\n`; // JSON.stringify escapes line breaks inside strings
}

/** Usage above 200% is taken as a bad value and dropped, as in Coucou. */
const MAX_USAGE = 2;

/**
 * The `plan.usage` event from what the Claude plan provider reported (ADR-076). Only these three fields are read;
 * a share that is not a finite number in 0..2, or an overage that is not true/false, is dropped. Undefined if nothing is left.
 */
export function planUsageEvent(usage: { fiveHour?: unknown; sevenDay?: unknown; overage?: unknown }): PlanUsageEvent | undefined {
  const share = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_USAGE;
  const event: PlanUsageEvent = {
    type: "plan.usage",
    ...(share(usage.fiveHour) ? { fiveHour: usage.fiveHour } : {}),
    ...(share(usage.sevenDay) ? { sevenDay: usage.sevenDay } : {}),
    ...(typeof usage.overage === "boolean" ? { overage: usage.overage } : {}),
  };
  return Object.keys(event).length > 1 ? event : undefined;
}

/**
 * Limits microphone levels to one event per `intervalMs`, carrying the loudest peak since the last one,
 * so a fast meter costs little and a short loud sound between events is never lost.
 */
export function createLevelThrottle(send: (peak: number) => void, intervalMs = 50, now: () => number = Date.now) {
  let pending = 0;
  let last = -Infinity;
  return {
    push(peak: number) {
      pending = Math.max(pending, peak);
      const t = now();
      if (t - last < intervalMs) return;
      last = t;
      send(Math.round(pending * 1000) / 1000);
      pending = 0;
    },
    reset() {
      pending = 0;
      last = -Infinity;
    },
  };
}
