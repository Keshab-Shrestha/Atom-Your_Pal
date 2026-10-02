// The messages between ZENO Island (Swift) and this runtime: JSON lines over stdin / stdout.
// The specification is docs/island-protocol.md; keep the two in step.

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
  | InfoEvent
  | { type: "error"; stage: ErrorStage; message: string; kind?: string; retryable?: boolean };

const COMMANDS = new Set<IslandCommand["type"]>(["talk.start", "talk.send", "talk.cancel", "conversation.reset", "model.set", "quit"]);

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
  return { command: { type } as IslandCommand }; // extra fields are ignored (forward compatibility)
}

/** One event as a single line of JSON, ending with a newline. */
export function encodeEvent(event: IslandEvent): string {
  return `${JSON.stringify(event)}\n`; // JSON.stringify escapes line breaks inside strings
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
