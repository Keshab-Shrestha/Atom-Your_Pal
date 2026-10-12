import type { DatabaseSync } from "node:sqlite";

/**
 * ADR-095: the sub-agents a task's runs started, for its thread: name, state, a short description and result. The
 * texts are the user's own: kept here, never logged (the change event carries the job, the name and the state).
 */

export const SUB_AGENT_DESCRIPTION_CHARS = 120;
export const SUB_AGENT_RESULT_CHARS = 200;
/** The newest sub-agents a task lists (each run starts at most 4). */
export const SUB_AGENTS_LISTED = 12;
const SUB_AGENT_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_KEY_CHARS = 100;

export type SubAgentState = "started" | "done" | "failed";

export interface SubAgent {
  name: string;
  state: SubAgentState;
  description: string;
  result?: string;
}

/** One start or end, as a run reports it; `id` tells one launch from another. */
export interface SubAgentEvent {
  id: string;
  name: string;
  state: SubAgentState;
  description?: string;
  result?: string;
}

const cut = (text: string | undefined, max: number) => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function subAgentTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sub_agents (
      job_id INTEGER NOT NULL,
      run_key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('started', 'done', 'failed')),
      result TEXT,
      PRIMARY KEY (job_id, run_key)
    );
  `);
  // A sub-agent cannot outlive the process whose run started it.
  db.exec("UPDATE sub_agents SET state = 'failed' WHERE state = 'started'");
  const start = db.prepare("INSERT OR IGNORE INTO sub_agents (job_id, run_key, name, description, state) VALUES (?, ?, ?, ?, 'started')");
  const end = db.prepare("UPDATE sub_agents SET state = ?, result = ? WHERE job_id = ? AND run_key = ? AND state = 'started'");
  const newest = db.prepare(
    `SELECT name, state, description, result FROM (SELECT rowid AS at, * FROM sub_agents WHERE job_id = ? ORDER BY rowid DESC LIMIT ${SUB_AGENTS_LISTED}) ORDER BY at`,
  );
  const drop = db.prepare("DELETE FROM sub_agents WHERE job_id = ?");
  // Only the listed ones are kept: a task's older sub-agents are dropped as new ones start.
  const prune = db.prepare(
    `DELETE FROM sub_agents WHERE job_id = ? AND rowid NOT IN (SELECT rowid FROM sub_agents WHERE job_id = ? ORDER BY rowid DESC LIMIT ${SUB_AGENTS_LISTED})`,
  );
  return {
    /** Records one start or end; false when nothing changed (a bad name, an end without its start, a repeat). */
    record(jobId: number, event: SubAgentEvent): boolean {
      if (!SUB_AGENT_NAME.test(event.name) || !event.id) return false;
      const key = event.id.slice(0, MAX_KEY_CHARS);
      if (event.state === "started") {
        if (Number(start.run(jobId, key, event.name, cut(event.description, SUB_AGENT_DESCRIPTION_CHARS)).changes) === 0) return false;
        prune.run(jobId, jobId);
        return true;
      }
      return Number(end.run(event.state, cut(event.result, SUB_AGENT_RESULT_CHARS) || null, jobId, key).changes) > 0;
    },
    of: (jobId: number): SubAgent[] =>
      (newest.all(jobId) as { name: string; state: SubAgentState; description: string; result: string | null }[]).map((r) => ({
        name: r.name,
        state: r.state,
        description: r.description,
        ...(r.result ? { result: r.result } : {}),
      })),
    drop: (jobId: number) => void drop.run(jobId),
  };
}
