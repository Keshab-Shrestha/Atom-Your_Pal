import type { HelperId } from "./jobs.ts";
import type { Job } from "./store.ts";

// ADR-087, Task 3.7: budgets. Spend is each run's reported cost, in US dollars of API-equivalent use (what the work
// would cost on the API; the Claude plan does not charge it). Caps are per day, local time. Numbers live in code and
// the store, never in a soul.

export const DEFAULT_WORKER_CAP = 5;
export const DEFAULT_TEAM_CAP = 15;
/** New runs wait while the plan's five-hour window is used above this (percent). */
export const DEFAULT_PLAN_LIMIT = 80;
/** The highest cap the window offers, and the range of the plan limit. */
export const MAX_CAP = 1000;
export const PLAN_LIMIT_RANGE = [10, 100] as const;

/** A cap and today's spend; `cap` null means no cap. */
export interface Budget {
  cap: number | null;
  spent: number;
}

export interface Budgets {
  team: Budget;
  workers: Record<HelperId, Budget>;
  /** Percent of the plan's five-hour window above which new runs wait (100: never). */
  planLimit: number;
}

export const isOver = (b: Budget) => b.cap !== null && b.spent >= b.cap;

export const dollars = (n: number) => `$${n.toFixed(2)}`;

/**
 * Why a runnable task may not start now, in words for the window, or undefined when it may. Only a queued task whose
 * blockers are done is held: the others wait anyway. `planUsed` is the plan's five-hour use in percent, when known.
 */
export function holdFor(job: Job, budgets: Budgets, workerName: string, planUsed?: number): string | undefined {
  if (job.state !== "queued" || job.waitingFor.length) return undefined;
  // Task 3.8: a plan waits for Keshab before anything else.
  if (job.planStatus === "awaiting") return `${workerName}'s plan waits for your OK.`;
  const own = budgets.workers[job.helper];
  if (own && isOver(own)) return `${workerName}'s daily budget (${dollars(own.cap!)}) is used up.`;
  if (isOver(budgets.team)) return `The team's daily budget (${dollars(budgets.team.cap!)}) is used up.`;
  if (planUsed !== undefined && budgets.planLimit < 100 && planUsed >= budgets.planLimit) {
    return `The Claude plan is ${Math.round(planUsed)}% used; new runs wait below ${budgets.planLimit}%.`;
  }
  return undefined;
}

/** The start of today, local time. */
export function startOfDay(now: Date): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day;
}
