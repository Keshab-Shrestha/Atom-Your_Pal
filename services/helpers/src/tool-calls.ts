import type { DatabaseSync } from "node:sqlite";

/**
 * B3.1: the activity timeline. The tool calls a task's runs made, one row each, for its thread. The texts arrive as
 * short redacted summaries (the run's loop makes them, so no secret reaches here); they are kept for the task's life
 * and dropped with it. Never logged: the change event carries the job only.
 */

export const TOOL_INPUT_CHARS = 160;
export const TOOL_RESULT_CHARS = 200;
/** A task keeps its newest calls only. */
export const TOOL_CALLS_KEPT = 200;
/** The thread lists the newest calls. */
export const TOOL_CALLS_LISTED = 100;
const MAX_KEY_CHARS = 100;
const MAX_NAME_CHARS = 80;
const AGENT_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export type ToolCallState = "started" | "ok" | "error";
const STATES: readonly string[] = ["started", "ok", "error"];

/** One start or end of a call, as the run reports it. A start needs `tool` and `input`; an end needs `id` and `state`. */
export interface ToolCallEvent {
  id: string;
  agent?: string;
  tool: string;
  input: string;
  state: ToolCallState;
  result?: string;
  /** ISO 8601. */
  at: string;
}

export interface ToolCall {
  id: string;
  agent?: string;
  tool: string;
  input: string;
  state: ToolCallState;
  result?: string;
  at: string;
  /** How long the call took, once it ended. */
  ms?: number;
}

export const TOOL_CALLS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    run_key TEXT NOT NULL,
    agent TEXT,
    tool TEXT NOT NULL,
    input TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('started', 'ok', 'error')),
    result TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    UNIQUE (job_id, run_key)
  );
  CREATE INDEX IF NOT EXISTS tool_calls_job ON tool_calls(job_id, id);
`;

const cut = (text: string | undefined, max: number) => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

type Row = { run_key: string; agent: string | null; tool: string; input: string; state: ToolCallState; result: string | null; started_at: string; ended_at: string | null };

export function toolCallTable(db: DatabaseSync) {
  db.exec(TOOL_CALLS_SCHEMA);
  // A call cannot outlive the process whose run made it.
  db.exec("UPDATE tool_calls SET state = 'error', result = 'Interrupted' WHERE state = 'started'");
  const start = db.prepare("INSERT OR IGNORE INTO tool_calls (job_id, run_key, agent, tool, input, state, started_at) VALUES (?, ?, ?, ?, ?, 'started', ?)");
  const end = db.prepare("UPDATE tool_calls SET state = ?, result = ?, ended_at = ? WHERE job_id = ? AND run_key = ? AND state = 'started'");
  const prune = db.prepare(
    `DELETE FROM tool_calls WHERE job_id = ? AND id NOT IN (SELECT id FROM tool_calls WHERE job_id = ? ORDER BY id DESC LIMIT ${TOOL_CALLS_KEPT})`,
  );
  const newest = db.prepare(
    `SELECT run_key, agent, tool, input, state, result, started_at, ended_at FROM (SELECT * FROM tool_calls WHERE job_id = ? ORDER BY id DESC LIMIT ${TOOL_CALLS_LISTED}) ORDER BY id`,
  );
  const drop = db.prepare("DELETE FROM tool_calls WHERE job_id = ?");
  return {
    /** Records one start or end; false when nothing changed (a bad state, an end without its start, a repeat). */
    record(jobId: number, event: ToolCallEvent): boolean {
      if (!STATES.includes(event.state) || !event.id) return false;
      const key = event.id.slice(0, MAX_KEY_CHARS);
      if (event.state === "started") {
        const tool = cut(event.tool, MAX_NAME_CHARS);
        if (!tool) return false;
        const agent = event.agent && AGENT_NAME.test(event.agent) ? event.agent : null;
        if (Number(start.run(jobId, key, agent, tool, cut(event.input, TOOL_INPUT_CHARS), event.at).changes) === 0) return false;
        prune.run(jobId, jobId);
        return true;
      }
      return Number(end.run(event.state, cut(event.result, TOOL_RESULT_CHARS) || null, event.at, jobId, key).changes) > 0;
    },
    of: (jobId: number): ToolCall[] =>
      (newest.all(jobId) as unknown as Row[]).map((r) => {
        const ms = r.ended_at ? Math.max(0, Date.parse(r.ended_at) - Date.parse(r.started_at)) : NaN;
        return {
          id: r.run_key,
          ...(r.agent ? { agent: r.agent } : {}),
          tool: r.tool,
          input: r.input,
          state: r.state,
          ...(r.result ? { result: r.result } : {}),
          at: r.started_at,
          ...(Number.isFinite(ms) ? { ms } : {}),
        };
      }),
    drop: (jobId: number) => void drop.run(jobId),
  };
}
