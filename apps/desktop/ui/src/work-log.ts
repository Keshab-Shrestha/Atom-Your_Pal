// The foreground work log (ADR-156): which tools ATOM used during the turn in view, how long it took, and how it ended. Foreground
// observations only: it is temporary, never restored from saved history, and not a record of permission or of what happened outside.
// A port of ChatWork.swift (validation and elapsed time) and the wording of ChatWorkView.swift.

import type { ChatWorkEvent } from "./protocol.ts";

/** The latest snapshot, `n` counting arrivals (so a component can time from the moment each one arrived), and whether the link to the runtime was lost. */
export interface WorkLog {
  work: ChatWorkEvent;
  n: number;
  interrupted?: true;
}

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const finiteWithin = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= DAY_MS;

/** The runtime's own limits, checked again here: a snapshot that breaks them is dropped, not shown. */
export function validWork(w: ChatWorkEvent): boolean {
  return typeof w.turn === "string" && UUID.test(w.turn) && typeof w.chat === "string" && w.chat !== "" && w.chat.length <= 100
    && finiteWithin(w.elapsedMs) && ["working", "completed", "failed", "stopped"].includes(w.state)
    && Array.isArray(w.calls) && w.calls.length <= 60 && Array.isArray(w.questions) && w.questions.length <= 4 && Number.isInteger(w.omitted) && w.omitted >= 0
    && w.calls.every((c) => UUID.test(c.id) && typeof c.tool === "string" && c.tool.length <= 100 && ["started", "ok", "error", "unknown"].includes(c.state) && (c.ms === undefined || finiteWithin(c.ms)))
    && w.questions.every((q) => UUID.test(q.id) && q.prompt.length <= 600 && q.choices.length <= 4 && q.choices.every((c) => c.length <= 100) && ["pending", "answered", "skipped", "expired"].includes(q.state));
}

export const isWorking = (log: WorkLog): boolean => log.work.state === "working" && !log.interrupted;

/** The log after the link to the runtime was lost: time stops, unfinished calls have an unknown outcome and a waiting question is skipped. */
export function interrupt(log: WorkLog): WorkLog {
  if (!isWorking(log)) return log;
  return {
    ...log,
    interrupted: true,
    work: {
      ...log.work,
      calls: log.work.calls.map((c) => (c.state === "started" ? { ...c, state: "unknown" as const } : c)),
      questions: log.work.questions.map((q) => (q.state === "pending" ? { ...q, state: "skipped" as const } : q)),
    },
  };
}

/** Elapsed time now: what the runtime reported plus the time since it did, while the work goes on. */
export const elapsedMs = (log: WorkLog, sinceReceived: number): number =>
  Math.min(DAY_MS, Math.max(0, log.work.elapsedMs + (isWorking(log) ? Math.max(0, sinceReceived) : 0)));

export function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export function workLabel(log: WorkLog, sinceReceived: number): string {
  const prefix = log.interrupted ? "Interrupted after" : { working: "Working for", completed: "Worked for", failed: "Failed after", stopped: "Stopped after" }[log.work.state];
  return `${prefix} ${duration(elapsedMs(log, sinceReceived))}`;
}

export const callWord = (state: ChatWorkEvent["calls"][number]["state"]): string =>
  state === "started" ? "Running" : state === "ok" ? "Finished" : state === "error" ? "Reported error" : "Outcome unknown";

export const callCount = (n: number): string => `${n} observed call${n === 1 ? "" : "s"}`;

/** What a settled question's row says: the answer, or why there is none. */
export const settledAnswer = (q: ChatWorkEvent["questions"][number]): string =>
  q.answer ?? (q.state === "expired" ? "No answer before the card expired." : "Question skipped or interrupted.");
