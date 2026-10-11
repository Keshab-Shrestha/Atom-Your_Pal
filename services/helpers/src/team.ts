import type { DatabaseSync } from "node:sqlite";
import { isOver, type Budgets } from "./budgets.ts";
import { HelperError, type HelperId } from "./jobs.ts";
import type { HelperChange } from "./store-types.ts";

// ADR-094 part B: team tasks (posted to the team, optionally for one role) and wake-ups (a worker's own clock). A worker
// that wakes, idle and within its budget and the plan's limit, takes the oldest team task its role may do and runs it as
// its own task. Task text stays in the store; changes carry ids and states only.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How often a worker may wake (off by default: no row). */
export const WAKE_EVERY = { "15m": 15 * MINUTE, "1h": HOUR, "4h": 4 * HOUR, "1d": 24 * HOUR } as const;
export type WakeEvery = keyof typeof WAKE_EVERY;
export const isWakeEvery = (v: unknown): v is WakeEvery => typeof v === "string" && Object.hasOwn(WAKE_EVERY, v);

/** Most team tasks waiting at once. */
export const MAX_TEAM_TASKS = 50;

/** A task posted to the team, waiting to be taken. No `role`: anyone may take it. */
export interface TeamTask {
  id: number;
  task: string;
  role?: string;
  createdAt: Date;
}

/** A worker's wake-up: how often, whether paused, when it last woke and when it wakes next. */
export interface WakeUp {
  every: WakeEvery;
  paused: boolean;
  lastAt?: Date;
  nextAt: Date;
}

/** "Every 15 minutes", "Every hour", "Every 4 hours", "Every day". */
export function describeWake(every: WakeEvery): string {
  return { "15m": "Every 15 minutes", "1h": "Every hour", "4h": "Every 4 hours", "1d": "Every day" }[every];
}

/** The next wake after `from`. */
export const nextWake = (every: WakeEvery, from: Date) => new Date(from.getTime() + WAKE_EVERY[every]);

/** One worker as this part of the store needs it: may it take tasks at all (available, not Tinker)? */
export interface TeamMember {
  id: HelperId;
  name: string;
  role: string;
  takesTasks: boolean;
}

export interface TeamDeps {
  db: DatabaseSync;
  now: () => Date;
  emit: (change: HelperChange) => void;
  transaction: (work: () => void) => void;
  members: () => TeamMember[];
  budgets: () => Budgets;
  cleanTask: (raw: string) => string;
  cleanRole: (raw: string) => string;
  /** Inserts a task for a worker (its own settings: plan first and so on); call inside a transaction. */
  insertTask: (helper: HelperId, task: string) => number;
}

/** What one wake did: the worker, and the team task it took and the task that became, if any. */
export interface Woken {
  helper: HelperId;
  teamTask?: number;
  job?: number;
}

export function teamStore(deps: TeamDeps) {
  const { db, now, emit } = deps;
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task TEXT NOT NULL,
      role TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wake_ups (
      helper TEXT PRIMARY KEY,
      every TEXT NOT NULL,
      paused INTEGER NOT NULL DEFAULT 0,
      last_at TEXT,
      next_at TEXT NOT NULL
    );
  `);
  const allTasks = db.prepare("SELECT * FROM team_tasks ORDER BY id");
  const insertTeamTask = db.prepare("INSERT INTO team_tasks (task, role, created_at) VALUES (?, ?, ?)");
  const dropTeamTask = db.prepare("DELETE FROM team_tasks WHERE id = ?");
  // The claim: one statement takes the oldest task the role may do, so two wakes can never take the same one.
  const claimOldest = db.prepare(
    "DELETE FROM team_tasks WHERE id = (SELECT id FROM team_tasks WHERE role IS NULL OR role = ? ORDER BY id LIMIT 1) RETURNING id, task",
  );
  const wakeOf = db.prepare("SELECT * FROM wake_ups WHERE helper = ?");
  const allWakes = db.prepare("SELECT * FROM wake_ups ORDER BY helper");
  const putWake = db.prepare(
    "INSERT INTO wake_ups (helper, every, paused, next_at) VALUES (?, ?, 0, ?) ON CONFLICT (helper) DO UPDATE SET every = excluded.every, paused = 0, next_at = excluded.next_at",
  );
  const dropWake = db.prepare("DELETE FROM wake_ups WHERE helper = ?");
  const pauseWake = db.prepare("UPDATE wake_ups SET paused = ?, next_at = COALESCE(?, next_at) WHERE helper = ?");
  const markWake = db.prepare("UPDATE wake_ups SET last_at = ?, next_at = ? WHERE helper = ?");
  // Idle: nothing running or queued, so a backlog never grows by one task per wake-up (Keshab's safe default).
  const isRunning = db.prepare("SELECT 1 FROM jobs WHERE helper = ? AND state IN ('running', 'queued') LIMIT 1");

  interface WakeRow {
    helper: string;
    every: string;
    paused: number;
    last_at: string | null;
    next_at: string;
  }
  const toWake = (row: WakeRow): WakeUp => ({
    every: isWakeEvery(row.every) ? row.every : "1d",
    paused: row.paused === 1,
    ...(row.last_at ? { lastAt: new Date(row.last_at) } : {}),
    nextAt: new Date(row.next_at),
  });

  /** A worker that may take tasks; throws HelperError otherwise. */
  function taker(helper: string): TeamMember {
    const member = deps.members().find((m) => m.id === helper);
    if (!member) throw new HelperError(`There is no helper called "${helper.slice(0, 40)}".`);
    if (!member.takesTasks) throw new HelperError(`${member.name} does not take tasks, so it has no wake-ups.`);
    return member;
  }

  /** Idle, within its own and the team's budget, and the plan below its limit (`planUsed` in percent, when known). */
  function mayTake(member: TeamMember, planUsed: number | undefined): boolean {
    if (isRunning.get(member.id)) return false;
    const budgets = deps.budgets();
    const own = budgets.workers[member.id];
    if ((own && isOver(own)) || isOver(budgets.team)) return false;
    return planUsed === undefined || budgets.planLimit >= 100 || planUsed < budgets.planLimit;
  }

  /** Takes the oldest team task the worker's role may do, as its own queued task, in one transaction. */
  function take(member: TeamMember): { teamTask: number; job: number } | undefined {
    let taken: { teamTask: number; job: number } | undefined;
    deps.transaction(() => {
      const row = claimOldest.get(member.role) as { id: number; task: string } | undefined;
      if (row) taken = { teamTask: row.id, job: deps.insertTask(member.id, row.task) };
    });
    return taken;
  }

  return {
    teamTasks(): TeamTask[] {
      return (allTasks.all() as { id: number; task: string; role: string | null; created_at: string }[]).map((r) => ({
        id: r.id,
        task: r.task,
        ...(r.role ? { role: r.role } : {}),
        createdAt: new Date(r.created_at),
      }));
    },

    addTeamTask(raw: string, rawRole?: string | null): TeamTask {
      const task = deps.cleanTask(raw);
      const role = rawRole?.trim() ? deps.cleanRole(rawRole) : null;
      if (role && !deps.members().some((m) => m.takesTasks && m.role === role)) throw new HelperError(`No worker is a ${role}.`);
      if ((allTasks.all() as unknown[]).length >= MAX_TEAM_TASKS) throw new HelperError(`${MAX_TEAM_TASKS} team tasks already wait to be taken.`);
      const id = Number(insertTeamTask.run(task, role, now().toISOString()).lastInsertRowid);
      emit({ action: "team", task: id, change: "added" });
      return this.teamTasks().find((t) => t.id === id)!;
    },

    removeTeamTask(id: number): boolean {
      if (Number(dropTeamTask.run(id).changes) === 0) return false;
      emit({ action: "team", task: id, change: "removed" });
      return true;
    },

    wakeUps(): Map<HelperId, WakeUp> {
      return new Map((allWakes.all() as unknown as WakeRow[]).map((r) => [r.helper as HelperId, toWake(r)]));
    },

    /** Turns a worker's wake-ups on (or changes how often; the next wake is one interval from now) or off (null). */
    setWakeUp(helper: string, every: WakeEvery | null): void {
      const member = every === null ? { id: helper as HelperId } : taker(helper);
      if (every === null) {
        if (Number(dropWake.run(member.id).changes) > 0) emit({ action: "wakeUp", helper: member.id, change: "off" });
        return;
      }
      if (!isWakeEvery(every)) throw new HelperError("A worker wakes every 15 minutes, hourly, every 4 hours or daily.");
      putWake.run(member.id, every, nextWake(every, now()).toISOString());
      emit({ action: "wakeUp", helper: member.id, change: "set" });
    },

    /** Pauses or resumes a worker's wake-ups; a resumed one wakes one interval from now. */
    pauseWakeUp(helper: string, paused: boolean): void {
      const row = wakeOf.get(helper) as WakeRow | undefined;
      if (!row) throw new HelperError("That worker has no wake-ups to pause.");
      const next = paused ? null : nextWake(toWake(row).every, now()).toISOString();
      pauseWake.run(paused ? 1 : 0, next, helper);
      emit({ action: "wakeUp", helper: helper as HelperId, change: paused ? "paused" : "resumed" });
    },

    /**
     * Wakes every worker whose time has come (not paused): its last and next wake are recorded; if it may take work now,
     * it takes the oldest team task its role may do (one per wake). Missed wakes while ZENO was closed count once.
     */
    runWakeUps(planUsed?: number): Woken[] {
      const at = now();
      const team = new Map(deps.members().map((m) => [m.id, m]));
      const woken: Woken[] = [];
      for (const row of allWakes.all() as unknown as WakeRow[]) {
        const wake = toWake(row);
        if (wake.paused || wake.nextAt > at) continue;
        markWake.run(at.toISOString(), nextWake(wake.every, at).toISOString(), row.helper);
        const member = team.get(row.helper as HelperId);
        if (!member?.takesTasks) continue; // an agent removed since: it simply does not wake
        const taken = mayTake(member, planUsed) ? take(member) : undefined;
        woken.push({ helper: member.id, ...taken });
        emit({ action: "wakeUp", helper: member.id, change: "woke", ...(taken ? { job: taken.job } : {}) });
        if (taken) {
          emit({ action: "team", task: taken.teamTask, change: "taken", helper: member.id, job: taken.job });
          emit({ action: "job", helper: member.id, job: taken.job, state: "queued" });
        }
      }
      return woken;
    },
  };
}
