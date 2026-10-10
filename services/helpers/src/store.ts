import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HELPERS, HelperError, findHelper, isFinal, move, type HelperId, type JobState } from "./jobs.ts";

// ADR-081: helper apps, jobs and reports in one local SQLite file. Task text, reports and source addresses
// are the user's own: kept here, never logged (callers log the change events, which carry ids and states only).

export const MAX_TASK_CHARS = 1000;
export const JOBS_PER_HELPER = 20;
export const CLOSED_WHILE_RUNNING = "ZENO was closed while this job ran";

export interface Source {
  title: string;
  url: string;
}

export interface Report {
  jobId: number;
  title: string;
  /** One line. */
  summary: string;
  body: string;
  /** http and https only. */
  sources: Source[];
}

export type ReportInput = Omit<Report, "jobId">;

export interface Job {
  id: number;
  helper: HelperId;
  task: string;
  state: JobState;
  /** What a running job is doing, in plain words. */
  step?: string;
  /** Ended at a limit with what it had. */
  partial: boolean;
  error?: string;
  createdAt: Date;
  endedAt?: Date;
  /** From the report, when there is one. */
  title?: string;
  summary?: string;
  /** The model it runs on, once chosen (ADR-083). */
  model?: string;
  /** Why that model, in plain words. */
  modelReason?: string;
}

export interface HelperView {
  id: HelperId;
  name: string;
  available: boolean;
  app: string | null;
  /** The model Keshab pinned this helper to (ADR-083), or null to let the Decision Engine choose. */
  pinnedModel: string | null;
  /** Newest first, at most JOBS_PER_HELPER. */
  jobs: Job[];
}

/** What changed, for logs and updates: ids, states and timings only. */
export type HelperChange =
  | { action: "app"; helper: HelperId }
  | { action: "pin"; helper: HelperId }
  | { action: "settings" }
  | { action: "model"; helper: HelperId; job: number }
  | { action: "job"; helper: HelperId; job: number; state: JobState; ms?: number }
  | { action: "step"; helper: HelperId; job: number }
  | { action: "deleted"; helper: HelperId; job: number };

export interface HelperStore {
  /** Every helper in the fixed order, with its newest jobs. */
  list(): HelperView[];
  /** Gives a helper its app; "" for none. Throws HelperError for an unknown helper. */
  setApp(helper: string, app: string): void;
  /** Pins a helper to a model; "" unpins. Throws HelperError for an unknown helper. The caller checks the model is offered. */
  pin(helper: string, model: string): void;
  /** Whether jobs may use the large model (ADR-083). Default true. */
  allowLarge(): boolean;
  setAllowLarge(allowed: boolean): void;
  /** Records a running job's model and why. False (and nothing saved) unless the job is running. */
  setModel(id: number, model: string, reason: string): boolean;
  /** Queues a job. Throws HelperError for an unknown or unavailable helper, or an empty or long task. */
  addJob(helper: string, task: string): Job;
  get(id: number): Job | undefined;
  /** Every queued job, oldest first (for the job runner). */
  queued(): Job[];
  /** Stops a queued or running job. False when there is no such job or it has ended. */
  stop(id: number): boolean;
  /** Deletes a job and its report, stopping it first if it has not ended. False when there is none. */
  remove(id: number): boolean;
  report(id: number): Report | undefined;
  /** For the job runner (Task 3.2). These throw HelperError for an unknown job or a move its life does not allow. */
  start(id: number): void;
  /** Records a running job's progress. False (and nothing saved) unless the job is running. */
  step(id: number, text: string): boolean;
  finish(id: number, report: ReportInput, partial?: boolean): void;
  fail(id: number, error: string, partial?: boolean): void;
  /** Called after every change. Returns an unsubscribe. */
  onChange(listener: (change: HelperChange) => void): () => void;
  close(): void;
}

export interface HelperStoreOptions {
  /** A file path, or ":memory:" for tests. */
  path: string;
  now?: () => Date;
}

interface JobRow {
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
}

interface ReportRow {
  job_id: number;
  title: string;
  summary: string;
  body: string;
  sources: string;
}

const toJob = (row: JobRow): Job => ({
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

export function openHelperStore(options: HelperStoreOptions): HelperStore {
  const { path, now = () => new Date() } = options;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
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
  `);
  // ADR-083: files from before Task 3.2b lack the model columns.
  const columns = new Set((db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name));
  for (const column of ["model", "model_reason"]) if (!columns.has(column)) db.exec(`ALTER TABLE jobs ADD COLUMN ${column} TEXT`);
  // A job cannot outlive the process that ran it.
  db.prepare("UPDATE jobs SET state = 'failed', step = NULL, error = ?, ended_at = ? WHERE state = 'running'").run(
    CLOSED_WHILE_RUNNING,
    now().toISOString(),
  );

  const appOf = db.prepare("SELECT app FROM helper_apps WHERE helper = ?");
  const putApp = db.prepare("INSERT INTO helper_apps (helper, app) VALUES (?, ?) ON CONFLICT (helper) DO UPDATE SET app = excluded.app");
  const dropApp = db.prepare("DELETE FROM helper_apps WHERE helper = ?");
  const pinOf = db.prepare("SELECT model FROM helper_models WHERE helper = ?");
  const putPin = db.prepare("INSERT INTO helper_models (helper, model) VALUES (?, ?) ON CONFLICT (helper) DO UPDATE SET model = excluded.model");
  const dropPin = db.prepare("DELETE FROM helper_models WHERE helper = ?");
  const settingOf = db.prepare("SELECT value FROM helper_settings WHERE key = ?");
  const putSetting = db.prepare("INSERT INTO helper_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  const setJobModel = db.prepare("UPDATE jobs SET model = ?, model_reason = ? WHERE id = ? AND state = 'running'");
  const newestJobs = db.prepare(
    "SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.helper = ? ORDER BY j.id DESC LIMIT ?",
  );
  const queuedJobs = db.prepare("SELECT * FROM jobs WHERE state = 'queued' ORDER BY id");
  const jobById = db.prepare("SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.id = ?");
  const insertJob = db.prepare("INSERT INTO jobs (helper, task, state, created_at) VALUES (?, ?, 'queued', ?)");
  const setState = db.prepare("UPDATE jobs SET state = ?, step = NULL, partial = ?, error = ?, ended_at = ? WHERE id = ?");
  const setStep = db.prepare("UPDATE jobs SET step = ? WHERE id = ? AND state = 'running'");
  const insertReport = db.prepare("INSERT OR REPLACE INTO reports (job_id, title, summary, body, sources) VALUES (?, ?, ?, ?, ?)");
  const reportById = db.prepare("SELECT * FROM reports WHERE job_id = ?");
  const deleteJob = db.prepare("DELETE FROM jobs WHERE id = ?");
  const deleteReport = db.prepare("DELETE FROM reports WHERE job_id = ?");

  const listeners = new Set<(change: HelperChange) => void>();
  const emit = (change: HelperChange) => {
    for (const listener of listeners) listener(change);
  };

  const get = (id: number) => {
    const row = jobById.get(id) as JobRow | undefined;
    return row ? toJob(row) : undefined;
  };

  function mustGet(id: number): Job {
    const job = get(id);
    if (!job) throw new HelperError(`There is no job ${id}.`);
    return job;
  }

  /** Moves a job to a new state through the state machine, saves it and tells listeners. */
  function transition(job: Job, to: JobState, fields: { partial?: boolean; error?: string } = {}) {
    move(job.state, to);
    const ended = isFinal(to) ? now() : undefined;
    setState.run(to, fields.partial ? 1 : 0, fields.error ?? null, ended?.toISOString() ?? null, job.id);
    emit({ action: "job", helper: job.helper, job: job.id, state: to, ...(ended ? { ms: ended.getTime() - job.createdAt.getTime() } : {}) });
  }

  function transaction(work: () => void) {
    db.exec("BEGIN");
    try {
      work();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    list() {
      return HELPERS.map((h) => ({
        id: h.id,
        name: h.name,
        available: h.available,
        app: (appOf.get(h.id) as { app: string } | undefined)?.app ?? null,
        pinnedModel: (pinOf.get(h.id) as { model: string } | undefined)?.model ?? null,
        jobs: (newestJobs.all(h.id, JOBS_PER_HELPER) as unknown as JobRow[]).map(toJob),
      }));
    },

    setApp(helper, app) {
      const known = findHelper(helper);
      if (!known) throw new HelperError(`There is no helper called "${helper.slice(0, 40)}".`);
      if (app) putApp.run(known.id, app);
      else dropApp.run(known.id);
      emit({ action: "app", helper: known.id });
    },

    pin(helper, model) {
      const known = findHelper(helper);
      if (!known) throw new HelperError(`There is no helper called "${helper.slice(0, 40)}".`);
      if (model) putPin.run(known.id, model);
      else dropPin.run(known.id);
      emit({ action: "pin", helper: known.id });
    },

    allowLarge() {
      return (settingOf.get("allowLarge") as { value: string } | undefined)?.value !== "false";
    },

    setAllowLarge(allowed) {
      putSetting.run("allowLarge", String(allowed));
      emit({ action: "settings" });
    },

    setModel(id, model, reason) {
      if (Number(setJobModel.run(model, reason, id).changes) === 0) return false;
      emit({ action: "model", helper: get(id)!.helper, job: id });
      return true;
    },

    addJob(helper, raw) {
      const known = findHelper(helper);
      if (!known) throw new HelperError(`There is no helper called "${helper.slice(0, 40)}".`);
      if (!known.available) throw new HelperError(`${known.name} is not ready yet.`);
      const task = raw.trim();
      if (!task) throw new HelperError("The job is empty.");
      if (task.length > MAX_TASK_CHARS) throw new HelperError(`The job is too long (${task.length} characters, limit ${MAX_TASK_CHARS}).`);
      const id = Number(insertJob.run(known.id, task, now().toISOString()).lastInsertRowid);
      emit({ action: "job", helper: known.id, job: id, state: "queued" });
      return mustGet(id);
    },

    get,

    queued() {
      return (queuedJobs.all() as unknown as JobRow[]).map(toJob);
    },

    stop(id) {
      const job = get(id);
      if (!job || isFinal(job.state)) return false;
      transition(job, "stopped");
      return true;
    },

    remove(id) {
      const job = get(id);
      if (!job) return false;
      if (!isFinal(job.state)) transition(job, "stopped"); // so a runner listening for "stopped" ends it
      transaction(() => {
        deleteReport.run(id);
        deleteJob.run(id);
      });
      emit({ action: "deleted", helper: job.helper, job: id });
      return true;
    },

    report(id) {
      const row = reportById.get(id) as ReportRow | undefined;
      if (!row) return undefined;
      return { jobId: row.job_id, title: row.title, summary: row.summary, body: row.body, sources: JSON.parse(row.sources) as Source[] };
    },

    start(id) {
      transition(mustGet(id), "running");
    },

    step(id, text) {
      if (Number(setStep.run(text, id).changes) === 0) return false;
      emit({ action: "step", helper: get(id)!.helper, job: id });
      return true;
    },

    finish(id, report, partial = false) {
      const job = mustGet(id);
      move(job.state, "done"); // refuse before anything is written
      const sources = webSources(report.sources).map((s) => ({ title: s.title, url: s.url }));
      transaction(() => {
        insertReport.run(id, report.title, report.summary, report.body, JSON.stringify(sources));
        transition(job, "done", { partial });
      });
    },

    fail(id, error, partial = false) {
      transition(mustGet(id), "failed", { partial, error });
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close() {
      db.close();
    },
  };
}
