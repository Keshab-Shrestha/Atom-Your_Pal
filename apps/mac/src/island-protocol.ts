// The messages between ZENO Island (Swift) and this runtime: JSON lines over stdin / stdout.
// The specification is docs/island-protocol.md; keep the two in step.

import type { Capability } from "@zeno/tool-engine";
import type { LoopState } from "./voice-loop.ts";

export const PROTOCOL_VERSION = 1;

/** Longest command line accepted, in characters. The biggest is a soul edit (`soul.set`); anything bigger is a bug or abuse. */
export const MAX_COMMAND_LENGTH = 16_384;

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
  | { type: "helpers.list" }
  | { type: "helper.set"; helper: string; app: string }
  | { type: "job.add"; helper: string; task: string; blockedBy?: number[]; planFirst?: boolean }
  | { type: "plan.approve"; id: number }
  | { type: "plan.reject"; id: number }
  | { type: "helper.planFirst"; helper: string; on: boolean }
  | { type: "routine.delete"; id: number }
  | { type: "grant.add"; helper: string; path: string }
  | { type: "helper.skills"; helper: string; skills: string[] }
  | { type: "job.rate"; id: number; good: boolean; comment?: string }
  | { type: "job.open"; id: number }
  | { type: "proposal.accept"; id: number }
  | { type: "proposal.reject"; id: number }
  | { type: "proposal.undo"; id: number }
  | { type: "grant.remove"; helper: string; path: string }
  | { type: "job.block"; id: number; blockedBy: number[] }
  | { type: "comment.add"; id: number; text: string }
  | { type: "thread.get"; id: number }
  | { type: "job.stop"; id: number }
  | { type: "job.fresh"; id: number }
  | { type: "job.delete"; id: number }
  | { type: "report.get"; id: number }
  | { type: "helper.pin"; helper: string; model: string }
  | { type: "helpers.settings"; allowLarge?: boolean; planLimit?: number }
  | { type: "helper.budget"; helper: string; cap: number | null }
  | { type: "soul.set"; helper: string; soul: SoulItem }
  | { type: "soul.restore"; helper: string; version: number }
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

/** One helper job (ADR-081). Task and report text travel only over the private pipe; never logged. */
export interface JobItem {
  id: number;
  task: string;
  state: "queued" | "running" | "done" | "failed" | "stopped";
  /** ISO 8601. */
  createdAt: string;
  endedAt?: string;
  step?: string;
  partial?: boolean;
  title?: string;
  summary?: string;
  error?: string;
  /** The model it runs on, once chosen (ADR-083). */
  model?: string;
  /** Why that model, in plain words ("Laya: trivial", "Pinned", …). */
  modelReason?: string;
  /** ADR-087: the tasks it waits for, those not done yet, and how many notes it has. */
  blockedBy: number[];
  waitingFor: number[];
  comments: number;
  goal?: string;
  /** Task 3.5: the goal it belongs to, and whether that goal has ended with its combined report. */
  goalId?: number;
  goalEnded?: boolean;
  /** Task 3.6: its next run continues the last one's session ("Start fresh" forgets it). */
  resumable?: boolean;
  /** Task 3.7: why a runnable task waits (a budget used up, the plan above its limit); it shows under "Needs you". */
  held?: string;
  /** Task 3.8: plan first; the plan's state and one-line summary once written. */
  planFirst?: boolean;
  planStatus?: "awaiting" | "approved";
  planSummary?: string;
  /** Task 3.13: Keshab's rating; for a Tinker task, the task it reviews. */
  rating?: "good" | "bad";
  reviews?: number;
  parentId?: number;
}

/** A task's thread (ADR-087, Task 3.4). Never logged. */
export interface ThreadEvent {
  type: "thread";
  id: number;
  comments: { id: number; text: string; createdAt: string }[];
  activity: { kind: string; at: string }[];
  report?: Omit<ReportEvent, "type" | "id">;
  /** Task 3.8: the plan a plan-first run wrote. */
  plan?: { summary: string; steps: string };
  /** Task 3.10: the sub-tasks this task handed off. */
  handOffs?: number[];
  /** Task 3.5: the goal the task is part of, its tasks, and the combined report once every task has ended. */
  goal?: { id: number; text: string; ended: boolean; tasks: number[]; report?: Omit<ReportEvent, "type" | "id"> };
}

/** Task 3.16: a task ZENO handed to Keshab's Paperclip. Titles and results never logged. */
export interface PaperclipItem {
  id: string;
  identifier?: string;
  title: string;
  agent: string;
  status: string;
  createdAt: string;
  result?: string;
  told?: boolean;
}

/** One model the Claude plan offers to worker jobs (ADR-083). */
export interface ModelItem {
  id: string;
  name: string;
  tier: "small" | "medium" | "large";
}

/** A worker's soul (ADR-082, Task 3.3). Travels only over the private pipe; never logged. */
export interface SoulItem {
  name: string;
  personality: string;
  howItWorks: string;
  rules: string;
  lessons: string;
}

/** One helper and its newest jobs (ADR-081), in the fixed order. */
export interface HelperItem {
  id: string;
  /** The soul's name. */
  name: string;
  available: boolean;
  role: string;
  soul: SoulItem;
  soulVersion: number;
  /** Newest first, at most 10; `createdAt` is ISO 8601. */
  soulVersions: { version: number; createdAt: string }[];
  app: string | null;
  /** The pinned model id (ADR-083), or null to let Laya choose. */
  pinnedModel: string | null;
  /** Task 3.7: the daily cap in dollars of API-equivalent use (null: none) and today's spend. */
  budget: { cap: number | null; spent: number };
  /** Task 3.8: its new tasks plan first. */
  planFirst: boolean;
  /** Task 3.9: its routines: `when` in words ("Every day at 8:00 AM"), when it last came due, and whether that was skipped. */
  routines: { id: number; task: string; when: string; lastAt?: string; lastSkipped?: boolean }[];
  /** Task 3.11: the folders it may work in (coder, designer, documenter). */
  grants: string[];
  /** Task 3.12: the skills chosen for it. */
  skills: string[];
  /** Task 3.13: Tinker's proposals for its soul: `field` changed to `text`, why, the task reviewed, and their state. */
  proposals: { id: number; field: string; text: string; reason: string; jobId: number; state: string; createdAt: string }[];
  jobs: JobItem[];
}

/** One job's report (ADR-081). Never logged. */
export interface ReportEvent {
  type: "report";
  id: number;
  title: string;
  summary: string;
  body: string;
  sources: { title: string; url: string }[];
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
  | {
      type: "helpers";
      helpers: HelperItem[];
      apps: string[];
      allowLarge?: boolean;
      models?: ModelItem[];
      /** Task 3.7: the team's daily cap and spend, and the plan limit (percent) above which new runs wait. */
      team?: { cap: number | null; spent: number };
      planLimit?: number;
      /** Task 3.12: Keshab's skills in ~/.claude/skills, for choosing. */
      skills?: { name: string; description: string }[];
      /** Task 3.16: the tasks handed to Keshab's Paperclip; absent when the connection is off. */
      paperclip?: { issues: PaperclipItem[] };
    }
  | ReportEvent
  | ThreadEvent
  /** Task 3.15: a line from the team (a goal done, a plan waiting), sent just before ZENO says it. */
  | { type: "worker.line"; line: string }
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
  "helpers.list",
  "helper.set",
  "job.add",
  "plan.approve",
  "plan.reject",
  "helper.planFirst",
  "routine.delete",
  "grant.add",
  "helper.skills",
  "job.rate",
  "job.open",
  "proposal.accept",
  "proposal.reject",
  "proposal.undo",
  "grant.remove",
  "job.stop",
  "job.fresh",
  "job.delete",
  "report.get",
  "helper.pin",
  "helpers.settings",
  "helper.budget",
  "soul.set",
  "soul.restore",
  "job.block",
  "comment.add",
  "thread.get",
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
  if (type === "helper.set") {
    const { helper, app } = value as { helper?: unknown; app?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.set needs a "helper" string.' };
    if (typeof app !== "string") return { error: 'helper.set needs an "app" string ("" for none).' };
    return { command: { type, helper, app } };
  }
  if (type === "job.add") {
    // An empty or long task is the store's to refuse (stage "settings"), as the protocol says.
    const { helper, task } = value as { helper?: unknown; task?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'job.add needs a "helper" string.' };
    if (typeof task !== "string") return { error: 'job.add needs a "task" string.' };
    const { blockedBy, planFirst } = value as { blockedBy?: unknown; planFirst?: unknown };
    if (blockedBy !== undefined && !isIdList(blockedBy)) return { error: 'job.add needs "blockedBy" to be a list of whole numbers.' };
    if (planFirst !== undefined && typeof planFirst !== "boolean") return { error: 'job.add needs "planFirst" to be true or false.' };
    return { command: { type, helper, task, ...(blockedBy !== undefined ? { blockedBy } : {}), ...(planFirst !== undefined ? { planFirst } : {}) } };
  }
  if (type === "job.rate") {
    const { id, good, comment } = value as { id?: unknown; good?: unknown; comment?: unknown };
    if (!isId(id)) return { error: 'job.rate needs an "id" that is a whole number.' };
    if (typeof good !== "boolean") return { error: 'job.rate needs "good" to be true or false.' };
    if (comment !== undefined && typeof comment !== "string") return { error: 'job.rate needs "comment" to be a string.' };
    return { command: { type, id, good, ...(comment !== undefined ? { comment } : {}) } };
  }
  if (type === "helper.skills") {
    const { helper, skills } = value as { helper?: unknown; skills?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.skills needs a "helper" string.' };
    if (!Array.isArray(skills) || skills.length > 20 || !skills.every((s) => typeof s === "string")) return { error: 'helper.skills needs "skills", a list of names.' };
    return { command: { type, helper, skills } };
  }
  if (type === "grant.add" || type === "grant.remove") {
    // Which folders may be granted is the store's to refuse (stage "settings").
    const { helper, path } = value as { helper?: unknown; path?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: `${type} needs a "helper" string.` };
    if (typeof path !== "string" || path === "" || path.length > 1024) return { error: `${type} needs a "path" string.` };
    return { command: { type, helper, path } };
  }
  if (type === "helper.planFirst") {
    const { helper, on } = value as { helper?: unknown; on?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.planFirst needs a "helper" string.' };
    if (typeof on !== "boolean") return { error: 'helper.planFirst needs "on" to be true or false.' };
    return { command: { type, helper, on } };
  }
  if (type === "job.block") {
    const { id, blockedBy } = value as { id?: unknown; blockedBy?: unknown };
    if (!isId(id)) return { error: 'job.block needs an "id" that is a whole number.' };
    if (!isIdList(blockedBy)) return { error: 'job.block needs "blockedBy" to be a list of whole numbers.' };
    return { command: { type, id, blockedBy } };
  }
  if (type === "comment.add") {
    // An empty or long note is the store's to refuse (stage "settings").
    const { id, text } = value as { id?: unknown; text?: unknown };
    if (!isId(id)) return { error: 'comment.add needs an "id" that is a whole number.' };
    if (typeof text !== "string") return { error: 'comment.add needs a "text" string.' };
    return { command: { type, id, text } };
  }
  if (type === "helper.pin") {
    // Whether the model is offered is the helpers' to refuse (stage "settings"), as the protocol says.
    const { helper, model } = value as { helper?: unknown; model?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.pin needs a "helper" string.' };
    if (typeof model !== "string") return { error: 'helper.pin needs a "model" string ("" to let Laya choose).' };
    return { command: { type, helper, model } };
  }
  if (type === "helpers.settings") {
    const { allowLarge, planLimit } = value as { allowLarge?: unknown; planLimit?: unknown };
    if (allowLarge !== undefined && typeof allowLarge !== "boolean") return { error: 'helpers.settings needs "allowLarge" to be true or false.' };
    if (planLimit !== undefined && typeof planLimit !== "number") return { error: 'helpers.settings needs "planLimit" to be a number.' };
    if (allowLarge === undefined && planLimit === undefined) return { error: 'helpers.settings needs "allowLarge" or "planLimit".' };
    return { command: { type, ...(allowLarge !== undefined ? { allowLarge } : {}), ...(planLimit !== undefined ? { planLimit } : {}) } };
  }
  if (type === "helper.budget") {
    // The amount's range is the store's to refuse (stage "settings").
    const { helper, cap } = value as { helper?: unknown; cap?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'helper.budget needs a "helper" string ("team" for the team).' };
    if (cap !== null && typeof cap !== "number") return { error: 'helper.budget needs a "cap" number, or null for none.' };
    return { command: { type, helper, cap } };
  }
  if (type === "soul.set") {
    // Lengths, names and empty fields are the store's to refuse (stage "settings"), as the protocol says.
    const { helper, soul } = value as { helper?: unknown; soul?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'soul.set needs a "helper" string.' };
    if (typeof soul !== "object" || soul === null || Array.isArray(soul)) return { error: 'soul.set needs a "soul" object.' };
    const fields = ["name", "personality", "howItWorks", "rules", "lessons"] as const;
    const s = soul as Record<string, unknown>;
    const missing = fields.find((f) => typeof s[f] !== "string");
    if (missing) return { error: `soul.set needs "soul.${missing}" as a string.` };
    const clean = Object.fromEntries(fields.map((f) => [f, s[f]])) as unknown as SoulItem; // extra fields dropped
    return { command: { type, helper, soul: clean } };
  }
  if (type === "soul.restore") {
    const { helper, version } = value as { helper?: unknown; version?: unknown };
    if (typeof helper !== "string" || helper === "") return { error: 'soul.restore needs a "helper" string.' };
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return { error: 'soul.restore needs a "version" that is a whole number.' };
    return { command: { type, helper, version } };
  }
  if (type === "memory.forget" || type === "episode.forget" || type === "job.stop" || type === "job.fresh" || type === "plan.approve" || type === "plan.reject" || type === "routine.delete" || type === "job.open" || type === "proposal.accept" || type === "proposal.reject" || type === "proposal.undo" || type === "job.delete" || type === "report.get" || type === "thread.get") {
    const { id } = value as { id?: unknown };
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return { error: `${type} needs an "id" that is a whole number.` };
    return { command: { type, id } };
  }
  return { command: { type } as IslandCommand }; // extra fields are ignored (forward compatibility)
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isIdList = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 20 && v.every(isId);

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
