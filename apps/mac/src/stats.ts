// ARK's tool and turn numbers for the Stats page (2026-11-05, idea from deepseek-harness "stats tab"). Counts from ARK's own log: which tools it
// ran, how often each failed, how long each took, how often the model repeated one, and how long the model took to answer. The log holds
// names, counts and times only: no input, no output, no text. Plain code: no model reads this.
import { readLogTail } from "./improve.ts";

const DAY_MS = 86_400_000;
export const STATS_DAYS = 7;
export const MAX_TOOL_ROWS = 12;
/** A model answer this slow is called slow (the same line as the notices use). */
export const SLOW_TURN_MS = 15_000;

export interface ToolRow { name: string; calls: number; failed: number; avgMs: number; repeats: number }
export interface Stats {
  days: number;
  turns: number;
  avgTurnMs: number;
  slowTurns: number;
  totalCalls: number;
  totalFailed: number;
  /** The tools used most, busiest first. */
  tools: ToolRow[];
}

export function computeStats(lines: readonly string[], now: Date, days = STATS_DAYS): Stats {
  const since = now.getTime() - days * DAY_MS;
  const tools = new Map<string, { calls: number; failed: number; ms: number; repeats: number }>();
  let turns = 0, turnMs = 0, slowTurns = 0;
  for (const line of lines) {
    let d: Record<string, unknown>;
    try { d = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const at = typeof d.time === "string" ? Date.parse(d.time) : NaN;
    if (!(at >= since)) continue;
    if (d.event === "tool.call" && typeof d.name === "string") {
      const t = tools.get(d.name) ?? { calls: 0, failed: 0, ms: 0, repeats: 0 };
      t.calls += 1;
      if (d.ok === false) t.failed += 1;
      if (typeof d.ms === "number" && d.ms >= 0) t.ms += d.ms;
      if (typeof d.repeat === "number" && d.repeat >= 3) t.repeats += 1;
      tools.set(d.name, t);
    } else if (d.event === "turn.complete" && typeof d.modelMs === "number" && d.modelMs > 0) {
      turns += 1; turnMs += d.modelMs;
      if (d.modelMs >= SLOW_TURN_MS) slowTurns += 1;
    }
  }
  const rows = [...tools].map(([name, t]) => ({ name, calls: t.calls, failed: t.failed, avgMs: Math.round(t.ms / t.calls), repeats: t.repeats }));
  rows.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
  return {
    days,
    turns,
    avgTurnMs: turns ? Math.round(turnMs / turns) : 0,
    slowTurns,
    totalCalls: rows.reduce((n, r) => n + r.calls, 0),
    totalFailed: rows.reduce((n, r) => n + r.failed, 0),
    tools: rows.slice(0, MAX_TOOL_ROWS),
  };
}

export const statsFromLog = (path: string, now = new Date()): Stats => computeStats(readLogTail(path), now);
