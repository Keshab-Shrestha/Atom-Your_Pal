import type { DatabaseSync } from "node:sqlite";
import { HelperError, type HelperId } from "./jobs.ts";

// ADR-087, Task 3.9: routines. A schedule makes a task for a worker; local time. Pure scheduling plus the table.

export type Schedule = { kind: "daily"; minute: number } | { kind: "weekly"; weekday: number; minute: number } | { kind: "hours"; every: number };

export interface Routine {
  id: number;
  helper: HelperId;
  task: string;
  schedule: Schedule;
  createdAt: Date;
  /** When it last came due (a task made, or skipped because the last one was still going). */
  lastAt?: Date;
  lastTaskId?: number;
  lastSkipped: boolean;
  /** ADR-094: paused routines make no tasks; a resumed one counts from when it was resumed (missed times are not made up). */
  paused: boolean;
  resumedAt?: Date;
  /** ADR-098: when its task ends, ATOM sends the result to Telegram. Default false. */
  notifyTelegram: boolean;
  /** ADR-098 item 5: a call to the local API's webhook may start it now. Default false. */
  webhook: boolean;
}

export const MAX_ROUTINES = 20;
export const MAX_EVERY_HOURS = 168;
export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const HOUR = 3_600_000;

/** Throws HelperError for a schedule that is not one of the three shapes with sensible numbers. */
export function checkSchedule(s: Schedule): Schedule {
  const minute = (m: number) => Number.isInteger(m) && m >= 0 && m < 24 * 60;
  if (s.kind === "daily" && minute(s.minute)) return { kind: "daily", minute: s.minute };
  if (s.kind === "weekly" && minute(s.minute) && Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6) {
    return { kind: "weekly", weekday: s.weekday, minute: s.minute };
  }
  if (s.kind === "hours" && Number.isInteger(s.every) && s.every >= 1 && s.every <= MAX_EVERY_HOURS) return { kind: "hours", every: s.every };
  throw new HelperError("A routine runs daily or weekly at a time, or every 1 to 168 hours.");
}

/** The latest time the schedule came due at or before `to`, or undefined (an hourly one not yet due once). */
export function lastDue(s: Schedule, createdAt: Date, to: Date): Date | undefined {
  if (s.kind === "hours") {
    const k = Math.floor((to.getTime() - createdAt.getTime()) / (s.every * HOUR));
    return k >= 1 ? new Date(createdAt.getTime() + k * s.every * HOUR) : undefined;
  }
  const at = new Date(to);
  at.setHours(Math.floor(s.minute / 60), s.minute % 60, 0, 0);
  const back = s.kind === "daily" ? (at > to ? 1 : 0) : (at.getDay() - s.weekday + 7) % 7 || (at > to ? 7 : 0);
  at.setDate(at.getDate() - back);
  return at;
}

/** Whether it came due since it last did (or since it was made): missed times while ATOM was closed count once. */
export function isDue(r: Pick<Routine, "schedule" | "createdAt" | "lastAt" | "resumedAt">, now: Date): boolean {
  const due = lastDue(r.schedule, r.createdAt, now);
  const since = Math.max((r.lastAt ?? r.createdAt).getTime(), r.resumedAt?.getTime() ?? 0);
  return due !== undefined && due.getTime() > since;
}

/**
 * ADR-097: the `createdAt` that makes an hourly schedule first come due at `startAt` (one period before it). Other kinds,
 * or no start, keep `fallback`.
 */
export function anchorFor(s: Schedule, startAt: Date | undefined, fallback: Date): Date {
  return s.kind === "hours" && startAt ? new Date(startAt.getTime() - s.every * HOUR) : fallback;
}

/** ADR-094: the first time the schedule comes due after `from` (for the Scheduled page). */
export function nextDue(s: Schedule, createdAt: Date, from: Date): Date {
  if (s.kind === "hours") {
    const k = Math.max(0, Math.floor((from.getTime() - createdAt.getTime()) / (s.every * HOUR)));
    return new Date(createdAt.getTime() + (k + 1) * s.every * HOUR);
  }
  const at = lastDue(s, createdAt, from)!; // daily and weekly always have one
  at.setDate(at.getDate() + (s.kind === "daily" ? 1 : 7));
  return at;
}

const clock = (minute: number) => {
  const h = Math.floor(minute / 60);
  return `${h % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** "Every day at 8:00 AM", "Every Monday at 9:30 AM", "Every 3 hours". */
export function describeSchedule(s: Schedule): string {
  if (s.kind === "hours") return s.every === 1 ? "Every hour" : `Every ${s.every} hours`;
  const day = s.kind === "daily" ? "day" : WEEKDAYS[s.weekday]![0]!.toUpperCase() + WEEKDAYS[s.weekday]!.slice(1);
  return `Every ${day} at ${clock(s.minute)}`;
}

const NUM = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?";

/**
 * "every morning at 8, summarise networking news", "every Monday at 9:30 am: …", "every 3 hours, …", "daily at 7 …".
 * Returns undefined for anything else (Pal's `schedule` tool handles other wordings).
 */
export function parseRoutine(text: string): { schedule: Schedule; task: string } | undefined {
  const s = text.trim();
  const hours = /^every\s+(\d{1,3})\s+hours?[,:\s]+(.+)$/is.exec(s) ?? /^every\s+hour[,:\s]+(.+)$/is.exec(s);
  if (hours) {
    const every = hours.length === 3 ? Number(hours[1]) : 1;
    const task = (hours.length === 3 ? hours[2] : hours[1])!.trim();
    if (every >= 1 && every <= MAX_EVERY_HOURS && task) return { schedule: { kind: "hours", every }, task };
    return undefined;
  }
  const m = new RegExp(`^(?:every|each)\\s+(day|morning|evening|night|afternoon|${WEEKDAYS.join("|")})\\s+at\\s+${NUM}[,:\\s]+(.+)$`, "is").exec(s)
    ?? new RegExp(`^(daily)\\s+at\\s+${NUM}[,:\\s]+(.+)$`, "is").exec(s);
  if (!m) return undefined;
  const [, when, h, min, ampm, rest] = m;
  let hour = Number(h);
  const minutes = min ? Number(min) : 0;
  const word = when!.toLowerCase();
  // Without am or pm: "evening" and "afternoon" are pm. "night" is the small hours for 12 (midnight) and 1 to 5, and the evening for 6 to 11
  // ("every night at 12" used to be saved as noon, and "at 1" as 1 PM; code check, 2026-10-16).
  const night = !ampm && word === "night";
  const pm = ampm ? ampm.toLowerCase().startsWith("p") : (word === "evening" || word === "afternoon" || (night && hour >= 6)) && hour < 12;
  if (ampm && (hour < 1 || hour > 12)) return undefined;
  if (pm && hour < 12) hour += 12;
  if (ampm && !pm && hour === 12) hour = 0;
  if (night && hour === 12) hour = 0;
  if (hour > 23 || minutes > 59 || !rest?.trim()) return undefined;
  const minute = hour * 60 + minutes;
  const weekday = WEEKDAYS.indexOf(word as (typeof WEEKDAYS)[number]);
  return { schedule: weekday >= 0 ? { kind: "weekly", weekday, minute } : { kind: "daily", minute }, task: rest.trim() };
}

interface RoutineRow {
  id: number;
  helper: string;
  task: string;
  schedule: string;
  created_at: string;
  last_at: string | null;
  last_task_id: number | null;
  last_skipped: number;
  paused: number | null;
  resumed_at: string | null;
  notify_telegram: number | null;
  webhook: number | null;
}

const toRoutine = (row: RoutineRow): Routine => ({
  id: row.id,
  helper: row.helper as HelperId,
  task: row.task,
  schedule: JSON.parse(row.schedule) as Schedule,
  createdAt: new Date(row.created_at),
  ...(row.last_at ? { lastAt: new Date(row.last_at) } : {}),
  ...(row.last_task_id != null ? { lastTaskId: row.last_task_id } : {}),
  lastSkipped: row.last_skipped === 1,
  paused: row.paused === 1,
  ...(row.resumed_at ? { resumedAt: new Date(row.resumed_at) } : {}),
  notifyTelegram: row.notify_telegram === 1,
  webhook: row.webhook === 1,
});

/** The routines table, for the store. The store checks the worker and the task text before `add`. */
export function routineTable(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    helper TEXT NOT NULL,
    task TEXT NOT NULL,
    schedule TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_at TEXT,
    last_task_id INTEGER,
    last_skipped INTEGER NOT NULL DEFAULT 0
  )`);
  // ADR-094: files from before the Scheduled page lack pause.
  const columns = new Set((db.prepare("PRAGMA table_info(routines)").all() as { name: string }[]).map((c) => c.name));
  if (!columns.has("paused")) db.exec("ALTER TABLE routines ADD COLUMN paused INTEGER");
  if (!columns.has("resumed_at")) db.exec("ALTER TABLE routines ADD COLUMN resumed_at TEXT");
  // ADR-098: send the result to Telegram.
  if (!columns.has("notify_telegram")) db.exec("ALTER TABLE routines ADD COLUMN notify_telegram INTEGER");
  // ADR-098 item 5: the local API's webhook may start it.
  if (!columns.has("webhook")) db.exec("ALTER TABLE routines ADD COLUMN webhook INTEGER");
  const all = db.prepare("SELECT * FROM routines ORDER BY id");
  const one = db.prepare("SELECT * FROM routines WHERE id = ?");
  const insert = db.prepare("INSERT INTO routines (helper, task, schedule, created_at) VALUES (?, ?, ?, ?)");
  const drop = db.prepare("DELETE FROM routines WHERE id = ?");
  const setPaused = db.prepare("UPDATE routines SET paused = ?, resumed_at = COALESCE(?, resumed_at) WHERE id = ?");
  const mark = db.prepare("UPDATE routines SET last_at = ?, last_task_id = COALESCE(?, last_task_id), last_skipped = ? WHERE id = ?");
  const markNative = db.prepare("UPDATE routines SET last_at = ?, last_task_id = NULL, last_skipped = ? WHERE id = ?");
  const change = db.prepare("UPDATE routines SET helper = ?, task = ?, schedule = ?, created_at = ?, resumed_at = ? WHERE id = ?");
  const setNotify = db.prepare("UPDATE routines SET notify_telegram = ? WHERE id = ?");
  const setWebhook = db.prepare("UPDATE routines SET webhook = ? WHERE id = ?");
  return {
    list: () => (all.all() as unknown as RoutineRow[]).map(toRoutine),
    get: (id: number) => {
      const row = one.get(id) as unknown as RoutineRow | undefined;
      return row ? toRoutine(row) : undefined;
    },
    add(helper: HelperId, task: string, schedule: Schedule, at: Date): number {
      if ((all.all() as unknown[]).length >= MAX_ROUTINES) throw new HelperError(`There are already ${MAX_ROUTINES} routines.`);
      return Number(insert.run(helper, task, JSON.stringify(checkSchedule(schedule)), at.toISOString()).lastInsertRowid);
    },
    remove: (id: number) => Number(drop.run(id).changes) > 0,
    mark: (id: number, at: Date, taskId: number | null, skipped: boolean) => void mark.run(at.toISOString(), taskId, skipped ? 1 : 0, id),
    /** ADR-110 (N3): a native run makes no task, so the routine keeps no last task (an old one would show forever). */
    markNative: (id: number, at: Date, skipped: boolean) => void markNative.run(at.toISOString(), skipped ? 1 : 0, id),
    /** ADR-097: a new worker, task or schedule. It counts from `at` (no missed time comes due); `createdAt` is the hourly anchor. */
    update: (id: number, helper: HelperId, task: string, schedule: Schedule, createdAt: Date, at: Date) =>
      Number(change.run(helper, task, JSON.stringify(checkSchedule(schedule)), createdAt.toISOString(), at.toISOString(), id).changes) > 0,
    /** ADR-098: whether its result goes to Telegram. */
    notify: (id: number, on: boolean) => Number(setNotify.run(on ? 1 : 0, id).changes) > 0,
    /** ADR-098 item 5: whether a webhook call may start it. */
    webhook: (id: number, on: boolean) => Number(setWebhook.run(on ? 1 : 0, id).changes) > 0,
    pause: (id: number, paused: boolean, at: Date) => Number(setPaused.run(paused ? 1 : 0, paused ? null : at.toISOString(), id).changes) > 0,
  };
}
