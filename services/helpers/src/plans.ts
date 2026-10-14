import type { DatabaseSync } from "node:sqlite";
import type { PlanPortionView, PlanView, PortionState } from "./store-types.ts";
import { blockedPortions, isComplete, type WorkPlan } from "./work-plan.ts";

/**
 * ADR-111 slice B: work plans. One row per plan (its chat, goal and portions as JSON) and one row per portion that
 * started (the Board job it became). Task text stays here; changes carry ids only. Plans are kept; nothing drops them.
 */

export interface StoredPlan extends WorkPlan {
  id: number;
  chatId: string;
  createdAt: Date;
}

export function planTable(db: DatabaseSync, now: () => Date) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      portions TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS work_plans_chat ON work_plans (chat_id, id);
    CREATE TABLE IF NOT EXISTS plan_jobs (
      plan_id INTEGER NOT NULL,
      n INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      PRIMARY KEY (plan_id, n)
    );
  `);
  const insert = db.prepare("INSERT INTO work_plans (chat_id, goal, portions, created_at) VALUES (?, ?, ?, ?)");
  const byId = db.prepare("SELECT * FROM work_plans WHERE id = ?");
  const newestOfChat = db.prepare("SELECT * FROM work_plans WHERE chat_id = ? ORDER BY id DESC LIMIT 1");
  const newest = db.prepare("SELECT * FROM work_plans ORDER BY id DESC LIMIT ?");
  const link = db.prepare("INSERT OR IGNORE INTO plan_jobs (plan_id, n, job_id) VALUES (?, ?, ?)");
  const jobsOf = db.prepare("SELECT n, job_id FROM plan_jobs WHERE plan_id = ? ORDER BY n");

  type Row = { id: number; chat_id: string; goal: string; portions: string; created_at: string };
  const toPlan = (row: Row): StoredPlan => ({ id: row.id, chatId: row.chat_id, goal: row.goal, portions: JSON.parse(row.portions) as WorkPlan["portions"], createdAt: new Date(row.created_at) });

  return {
    add(chatId: string, plan: WorkPlan): number {
      return Number(insert.run(chatId, plan.goal, JSON.stringify(plan.portions), now().toISOString()).lastInsertRowid);
    },
    get: (id: number): StoredPlan | undefined => {
      const row = byId.get(id) as Row | undefined;
      return row && toPlan(row);
    },
    /** The newest plan of a chat. */
    latestOf: (chatId: string): StoredPlan | undefined => {
      const row = newestOfChat.get(chatId) as Row | undefined;
      return row && toPlan(row);
    },
    newest: (limit: number): StoredPlan[] => (newest.all(limit) as Row[]).map(toPlan),
    /** True when the portion was linked now; false when it had a job already (a second start of one portion). */
    link: (planId: number, n: number, job: number): boolean => Number(link.run(planId, n, job).changes) > 0,
    jobs: (planId: number): { n: number; job: number }[] => (jobsOf.all(planId) as { n: number; job_id: number }[]).map((r) => ({ n: r.n, job: r.job_id })),
  };
}

/**
 * A stored plan with the state of each portion. Pure: `jobs` says which Board job each started portion became,
 * `jobState` gives that job's state (undefined: the job is gone, so the portion reads as running), `nameOf` an agent's name.
 */
export function viewOfPlan(stored: StoredPlan, links: readonly { n: number; job: number }[], jobState: (job: number) => string | undefined, nameOf: (agent: string) => string): PlanView {
  const jobs = new Map(links.map((j) => [j.n, j.job]));
  const state = (n: number): PortionState => {
    const job = jobs.get(n);
    if (job === undefined) return "waiting";
    const found = jobState(job);
    return found === "done" || found === "failed" || found === "stopped" ? found : "running";
  };
  const failed = new Set(stored.portions.filter((p) => state(p.n) === "failed" || state(p.n) === "stopped").map((p) => p.n));
  const blocked = new Set(blockedPortions(stored, failed));
  const done = new Set(stored.portions.filter((p) => state(p.n) === "done").map((p) => p.n));
  const portions: PlanPortionView[] = stored.portions.map((p) => ({
    n: p.n,
    agent: p.agent,
    name: nameOf(p.agent),
    task: p.task,
    after: p.after,
    ...(jobs.has(p.n) ? { job: jobs.get(p.n)! } : {}),
    state: blocked.has(p.n) ? "blocked" : state(p.n),
  }));
  const complete = isComplete(stored, done);
  const running = portions.some((p) => p.state === "running");
  const canStart = portions.some((p) => p.state === "waiting" && p.after.every((a) => done.has(a)));
  return { id: stored.id, chatId: stored.chatId, goal: stored.goal, createdAt: stored.createdAt, portions, complete, stuck: !complete && !running && (failed.size > 0 || blocked.size > 0) && !canStart };
}
