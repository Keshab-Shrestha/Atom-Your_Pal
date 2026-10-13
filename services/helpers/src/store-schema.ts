import type { DatabaseSync } from "node:sqlite";
import type { HelperId, JobState, Soul } from "./jobs.ts";
import type { Job, Source } from "./store.ts";
import { CHECKPOINTS_SCHEMA } from "./checkpoints.ts";
import { TOOL_CALLS_SCHEMA } from "./tool-calls.ts";
import { SKILL_HUB_SCHEMA } from "./skill-hub.ts";

// The helper store's tables, the migrations of older files, and its rows as values (split from store.ts).

/** Creates the tables, and adds the columns older files lack. */
export function createSchema(db: DatabaseSync) {
  db.exec(TOOL_CALLS_SCHEMA); // B3.1
  db.exec(CHECKPOINTS_SCHEMA); // B3.4
  db.exec(SKILL_HUB_SCHEMA); // B3.5
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS helper_apps (
      helper TEXT PRIMARY KEY,
      app TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      helper TEXT NOT NULL,
      task TEXT NOT NULL,
      state TEXT NOT NULL,
      step TEXT,
      partial INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS jobs_helper ON jobs(helper, id);
    CREATE TABLE IF NOT EXISTS reports (
      job_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      sources TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS helper_models (
      helper TEXT PRIMARY KEY,
      model TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS helper_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_blockers (
      job_id INTEGER NOT NULL,
      blocker_id INTEGER NOT NULL,
      PRIMARY KEY (job_id, blocker_id)
    );
    CREATE INDEX IF NOT EXISTS job_blockers_blocker ON job_blockers(blocker_id);
    CREATE TABLE IF NOT EXISTS job_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS souls (
      helper TEXT NOT NULL,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      personality TEXT NOT NULL,
      how_it_works TEXT NOT NULL,
      rules TEXT NOT NULL,
      lessons TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (helper, version)
    );
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ended_at TEXT,
      report TEXT,
      source TEXT
    );
    CREATE TABLE IF NOT EXISTS helper_skills (
      helper TEXT NOT NULL,
      skill TEXT NOT NULL,
      PRIMARY KEY (helper, skill)
    );
    CREATE TABLE IF NOT EXISTS grants (
      helper TEXT NOT NULL,
      path TEXT NOT NULL,
      PRIMARY KEY (helper, path)
    );
    CREATE TABLE IF NOT EXISTS spend (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      helper TEXT NOT NULL,
      dollars REAL NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS spend_at ON spend(at);
  `);
  // ADR-098: goals from before the source column have none (NULL).
  const goalColumns = new Set((db.prepare("PRAGMA table_info(goals)").all() as { name: string }[]).map((c) => c.name));
  if (!goalColumns.has("source")) db.exec("ALTER TABLE goals ADD COLUMN source TEXT");
  // ADR-107: the project of the chat that made the goal; NULL for goals from before projects.
  if (!goalColumns.has("project_id")) db.exec("ALTER TABLE goals ADD COLUMN project_id TEXT");
  // ADR-083: files from before Task 3.2b lack the model columns.
  const columns = new Set((db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name));
  for (const column of ["model", "model_reason", "goal"]) if (!columns.has(column)) db.exec(`ALTER TABLE jobs ADD COLUMN ${column} TEXT`);
  // ADR-087: files from before Task 3.4 lack the task columns.
  for (const column of ["parent_id", "goal_id", "wake_pending", "seen_comments", "brief_from"]) if (!columns.has(column)) db.exec(`ALTER TABLE jobs ADD COLUMN ${column} INTEGER`);
  // Task 3.6: the Claude session the next run resumes.
  if (!columns.has("session_id")) db.exec("ALTER TABLE jobs ADD COLUMN session_id TEXT");
  // Task 3.8: plan first.
  if (!columns.has("plan_first")) db.exec("ALTER TABLE jobs ADD COLUMN plan_first INTEGER");
  // Task 3.13: Keshab's rating, and for Tinker's review tasks the task reviewed.
  for (const column of ["rating", "rating_comment"]) if (!columns.has(column)) db.exec(`ALTER TABLE jobs ADD COLUMN ${column} TEXT`);
  if (!columns.has("reviews")) db.exec("ALTER TABLE jobs ADD COLUMN reviews INTEGER");
  // ADR-090: how many times a failure was retried by itself.
  if (!columns.has("auto_retries")) db.exec("ALTER TABLE jobs ADD COLUMN auto_retries INTEGER");
  for (const column of ["plan", "plan_summary", "plan_status"]) if (!columns.has(column)) db.exec(`ALTER TABLE jobs ADD COLUMN ${column} TEXT`);
  // ADR-094: what a Tinker task does besides reviewing a soul ("skill": draft one, "edit": edit one), and which skill.
  for (const column of ["review_kind", "review_skill"]) if (!columns.has(column)) db.exec(`ALTER TABLE jobs ADD COLUMN ${column} TEXT`);
  // ADR-098 item 3: an interrupted task waits for Keshab; his messages to a running task ("live" or "after").
  if (!columns.has("interrupted")) db.exec("ALTER TABLE jobs ADD COLUMN interrupted INTEGER");
  const noteColumns = new Set((db.prepare("PRAGMA table_info(job_comments)").all() as { name: string }[]).map((c) => c.name));
  if (!noteColumns.has("delivery")) db.exec("ALTER TABLE job_comments ADD COLUMN delivery TEXT");
}

export interface JobRow {
  id: number;
  helper: string;
  task: string;
  state: string;
  step: string | null;
  partial: number;
  error: string | null;
  created_at: string;
  ended_at: string | null;
  title?: string | null;
  summary?: string | null;
  model: string | null;
  model_reason: string | null;
  goal: string | null;
  goal_id: number | null;
  parent_id: number | null;
  session_id: string | null;
  wake_pending: number | null;
  seen_comments: number | null;
  brief_from: number | null;
  plan_first: number | null;
  plan: string | null;
  plan_summary: string | null;
  plan_status: string | null;
  interrupted?: number | null;
  rating: string | null;
  rating_comment: string | null;
  reviews: number | null;
  review_kind: string | null;
  review_skill: string | null;
  auto_retries: number | null;
}

export interface SoulRow {
  version: number;
  name: string;
  personality: string;
  how_it_works: string;
  rules: string;
  lessons: string;
}

export const toSoul = (row: SoulRow): Soul => ({
  name: row.name,
  personality: row.personality,
  howItWorks: row.how_it_works,
  rules: row.rules,
  lessons: row.lessons,
});

export const sameSoul = (a: Soul, b: Soul) => (Object.keys(a) as (keyof Soul)[]).every((k) => a[k] === b[k]);

export interface ReportRow {
  job_id: number;
  title: string;
  summary: string;
  body: string;
  sources: string;
}

export const toJobRow = (row: JobRow): Omit<Job, "blockedBy" | "waitingFor" | "comments" | "goalEnded"> => ({
  id: row.id,
  helper: row.helper as HelperId,
  task: row.task,
  state: row.state as JobState,
  ...(row.step && row.state === "running" ? { step: row.step } : {}),
  partial: row.partial === 1,
  ...(row.error ? { error: row.error } : {}),
  createdAt: new Date(row.created_at),
  ...(row.ended_at ? { endedAt: new Date(row.ended_at) } : {}),
  ...(row.title != null ? { title: row.title } : {}),
  ...(row.summary != null ? { summary: row.summary } : {}),
  ...(row.model ? { model: row.model } : {}),
  ...(row.model_reason ? { modelReason: row.model_reason } : {}),
  ...(row.goal ? { goal: row.goal } : {}),
  ...(row.goal_id != null ? { goalId: row.goal_id } : {}),
  ...(row.parent_id != null ? { parentId: row.parent_id } : {}),
  resumable: Boolean(row.session_id),
  wakePending: row.wake_pending === 1,
  ...(row.interrupted === 1 && row.state === "queued" ? { interrupted: true } : {}),
  planFirst: row.plan_first === 1,
  ...(row.plan_status === "awaiting" || row.plan_status === "approved" ? { planStatus: row.plan_status } : {}),
  ...(row.plan_summary ? { planSummary: row.plan_summary } : {}),
  ...(row.rating === "good" || row.rating === "bad" ? { rating: row.rating } : {}),
  ...(row.reviews != null ? { reviews: row.reviews } : {}),
  ...(row.review_kind === "skill" || row.review_kind === "edit" ? { reviewKind: row.review_kind } : {}),
  ...(row.review_skill ? { reviewSkill: row.review_skill } : {}),
  autoRetries: row.auto_retries ?? 0,
});

/** Sources with an http or https address only; anything else (javascript:, file:, junk) is dropped. */
export function webSources(sources: readonly Source[]): Source[] {
  return sources.filter((s) => {
    try {
      const { protocol } = new URL(s.url);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  });
}
