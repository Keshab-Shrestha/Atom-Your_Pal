import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  HELPERS,
  HelperError,
  MAX_BLOCKERS,
  cleanSoul,
  findHelper,
  isFinal,
  makesCycle,
  move,
  type HelperId,
  type JobState,
  type Soul,
  type TaskContext,
} from "./jobs.ts";

// ADR-081: helper apps, jobs and reports in one local SQLite file. Task text, reports and source addresses
// are the user's own: kept here, never logged (callers log the change events, which carry ids and states only).

export const MAX_TASK_CHARS = 1000;
export const MAX_GOAL_CHARS = 1000;
export const MAX_COMMENT_CHARS = 2000;
export const JOBS_PER_HELPER = 20;
export const CLOSED_WHILE_RUNNING = "ZENO was closed while this job ran";
/** Soul versions listed per worker (all are kept). */
export const SOUL_VERSIONS_LISTED = 10;

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
  /** ADR-087: the goal it is part of, and the task that created it. */
  goal?: string;
  parentId?: number;
  /** The tasks it waits for, and those of them not done yet (it starts when this is empty). */
  blockedBy: number[];
  waitingFor: number[];
  /** How many notes Keshab added. */
  comments: number;
}

export interface Comment {
  id: number;
  text: string;
  createdAt: Date;
}

/** One line of a task's activity: what happened and when (ids and states only, as in the logs). */
export interface Activity {
  kind: "created" | "waits" | "commented" | JobState;
  at: Date;
}

/** A task's thread (ADR-087): Keshab's notes, what happened, and the report. */
export interface Thread {
  id: number;
  comments: Comment[];
  activity: Activity[];
  report?: Report;
}

export interface AddJobOptions {
  /** Tasks this one waits for: each must exist and must not have failed or been stopped. */
  blockedBy?: readonly number[];
  goal?: string;
  parentId?: number;
}

export interface SoulVersion {
  version: number;
  createdAt: Date;
}

export interface HelperView {
  id: HelperId;
  /** The soul's name. */
  name: string;
  available: boolean;
  role: string;
  /** The current soul (ADR-082, Task 3.3). */
  soul: Soul;
  soulVersion: number;
  /** Newest first, at most SOUL_VERSIONS_LISTED. */
  soulVersions: SoulVersion[];
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
  | { action: "soul"; helper: HelperId; version: number }
  | { action: "settings" }
  | { action: "model"; helper: HelperId; job: number }
  | { action: "job"; helper: HelperId; job: number; state: JobState; ms?: number }
  | { action: "step"; helper: HelperId; job: number }
  | { action: "comment"; helper: HelperId; job: number }
  | { action: "blockers"; helper: HelperId; job: number }
  | { action: "deleted"; helper: HelperId; job: number };

export interface HelperStore {
  /** Every helper in the fixed order, with its newest jobs. */
  list(): HelperView[];
  /** Gives a helper its app; "" for none. Throws HelperError for an unknown helper. */
  setApp(helper: string, app: string): void;
  /** Pins a helper to a model; "" unpins. Throws HelperError for an unknown helper. The caller checks the model is offered. */
  pin(helper: string, model: string): void;
  /** A worker's current soul. Throws HelperError for an unknown helper. */
  soul(helper: string): Soul;
  /** Saves an edited soul as a new version (nothing when unchanged). Throws HelperError for an unknown helper or a bad soul. */
  saveSoul(helper: string, soul: Soul): void;
  /** Makes an older version current again, as a new version, so the restore can itself be undone. */
  restoreSoul(helper: string, version: number): void;
  /** Whether jobs may use the large model (ADR-083). Default true. */
  allowLarge(): boolean;
  setAllowLarge(allowed: boolean): void;
  /** Records a running job's model and why. False (and nothing saved) unless the job is running. */
  setModel(id: number, model: string, reason: string): boolean;
  /** Queues a job. Throws HelperError for an unknown or unavailable helper, an empty or long task, or bad blockers. */
  addJob(helper: string, task: string, options?: AddJobOptions): Job;
  get(id: number): Job | undefined;
  /** Every queued job whose blockers are all done, oldest first (for the job runner). */
  queued(): Job[];
  /** Changes what a queued task waits for. Throws HelperError for a task that is not queued, bad blockers, or a circle. */
  setBlockers(id: number, blockedBy: readonly number[]): void;
  /** Adds Keshab's note to a task. Throws HelperError for an unknown task or an empty or long note. */
  addComment(id: number, text: string): void;
  thread(id: number): Thread | undefined;
  /** What a task is given when it runs: its goal, notes and the reports of the tasks it waited for. */
  context(id: number): TaskContext;
  /** Stops a queued or running job. False when there is no such job or it has ended. */
  stop(id: number): boolean;
  /** Deletes a job and its report, stopping it first if it has not ended. False when there is none. */
  remove(id: number): boolean;
  report(id: number): Report | undefined;
  /**
   * For the job runner (Task 3.2). These throw HelperError for an unknown job or a move its life does not allow.
   * `start` claims a queued task whose blockers are done, atomically: a second claim throws.
   */
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
  goal: string | null;
  parent_id: number | null;
}

interface SoulRow {
  version: number;
  name: string;
  personality: string;
  how_it_works: string;
  rules: string;
  lessons: string;
}

const toSoul = (row: SoulRow): Soul => ({
  name: row.name,
  personality: row.personality,
  howItWorks: row.how_it_works,
  rules: row.rules,
  lessons: row.lessons,
});

const sameSoul = (a: Soul, b: Soul) => (Object.keys(a) as (keyof Soul)[]).every((k) => a[k] === b[k]);

interface ReportRow {
  job_id: number;
  title: string;
  summary: string;
  body: string;
  sources: string;
}

const toJobRow = (row: JobRow): Omit<Job, "blockedBy" | "waitingFor" | "comments"> => ({
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
  ...(row.parent_id != null ? { parentId: row.parent_id } : {}),
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
  `);
  // ADR-083: files from before Task 3.2b lack the model columns.
  const columns = new Set((db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name));
  for (const column of ["model", "model_reason", "goal"]) if (!columns.has(column)) db.exec(`ALTER TABLE jobs ADD COLUMN ${column} TEXT`);
  // ADR-087: files from before Task 3.4 lack the task columns.
  if (!columns.has("parent_id")) db.exec("ALTER TABLE jobs ADD COLUMN parent_id INTEGER");
  const opened = now();
  // A job cannot outlive the process that ran it.
  db.prepare("UPDATE jobs SET state = 'failed', step = NULL, error = ?, ended_at = ? WHERE state = 'running'").run(
    CLOSED_WHILE_RUNNING,
    opened.toISOString(),
  );

  const appOf = db.prepare("SELECT app FROM helper_apps WHERE helper = ?");
  const putApp = db.prepare("INSERT INTO helper_apps (helper, app) VALUES (?, ?) ON CONFLICT (helper) DO UPDATE SET app = excluded.app");
  const dropApp = db.prepare("DELETE FROM helper_apps WHERE helper = ?");
  const pinOf = db.prepare("SELECT model FROM helper_models WHERE helper = ?");
  const putPin = db.prepare("INSERT INTO helper_models (helper, model) VALUES (?, ?) ON CONFLICT (helper) DO UPDATE SET model = excluded.model");
  const dropPin = db.prepare("DELETE FROM helper_models WHERE helper = ?");
  const settingOf = db.prepare("SELECT value FROM helper_settings WHERE key = ?");
  const putSetting = db.prepare("INSERT INTO helper_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  const soulRow = db.prepare("SELECT * FROM souls WHERE helper = ? AND version = ?");
  const latestSoul = db.prepare("SELECT * FROM souls WHERE helper = ? ORDER BY version DESC LIMIT 1");
  const soulVersions = db.prepare("SELECT version, created_at FROM souls WHERE helper = ? ORDER BY version DESC LIMIT ?");
  const insertSoul = db.prepare(
    "INSERT INTO souls (helper, version, name, personality, how_it_works, rules, lessons, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const putSoul = (helper: HelperId, version: number, soul: Soul, at = now()) =>
    insertSoul.run(helper, version, soul.name, soul.personality, soul.howItWorks, soul.rules, soul.lessons, at.toISOString());
  // Version 1 of every soul is the roster's default, so it can be restored like any other.
  for (const h of HELPERS) if (!latestSoul.get(h.id)) putSoul(h.id, 1, h.soul, opened);
  const setJobModel = db.prepare("UPDATE jobs SET model = ?, model_reason = ? WHERE id = ? AND state = 'running'");
  const newestJobs = db.prepare(
    "SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.helper = ? ORDER BY j.id DESC LIMIT ?",
  );
  // Queued, and every task it waits for is done (a deleted one no longer holds it back).
  const queuedJobs = db.prepare(`
    SELECT * FROM jobs j WHERE j.state = 'queued' AND NOT EXISTS (
      SELECT 1 FROM job_blockers b JOIN jobs x ON x.id = b.blocker_id WHERE b.job_id = j.id AND x.state != 'done'
    ) ORDER BY j.id`);
  const blockersOf = db.prepare("SELECT b.blocker_id AS id, x.state FROM job_blockers b JOIN jobs x ON x.id = b.blocker_id WHERE b.job_id = ? ORDER BY b.blocker_id");
  const allBlockers = db.prepare("SELECT job_id, blocker_id FROM job_blockers");
  const dependents = db.prepare("SELECT j.id FROM job_blockers b JOIN jobs j ON j.id = b.job_id WHERE b.blocker_id = ? AND j.state = 'queued' ORDER BY j.id");
  const insertBlocker = db.prepare("INSERT INTO job_blockers (job_id, blocker_id) VALUES (?, ?)");
  const clearBlockers = db.prepare("DELETE FROM job_blockers WHERE job_id = ?");
  const dropLinks = db.prepare("DELETE FROM job_blockers WHERE job_id = ? OR blocker_id = ?");
  const insertComment = db.prepare("INSERT INTO job_comments (job_id, text, created_at) VALUES (?, ?, ?)");
  const commentsOf = db.prepare("SELECT id, text, created_at FROM job_comments WHERE job_id = ? ORDER BY id");
  const commentCount = db.prepare("SELECT COUNT(*) AS n FROM job_comments WHERE job_id = ?");
  const deleteComments = db.prepare("DELETE FROM job_comments WHERE job_id = ?");
  const insertEvent = db.prepare("INSERT INTO job_events (job_id, kind, at) VALUES (?, ?, ?)");
  const eventsOf = db.prepare("SELECT kind, at FROM job_events WHERE job_id = ? ORDER BY id");
  const deleteEvents = db.prepare("DELETE FROM job_events WHERE job_id = ?");
  const claim = db.prepare("UPDATE jobs SET state = 'running', step = NULL WHERE id = ? AND state = 'queued'");
  const jobById = db.prepare("SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.id = ?");
  const insertJob = db.prepare("INSERT INTO jobs (helper, task, state, created_at, goal, parent_id) VALUES (?, ?, 'queued', ?, ?, ?)");
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

  const toJob = (row: JobRow): Job => {
    const blockers = blockersOf.all(row.id) as { id: number; state: string }[];
    return {
      ...toJobRow(row),
      blockedBy: blockers.map((b) => b.id),
      waitingFor: blockers.filter((b) => b.state !== "done").map((b) => b.id),
      comments: Number((commentCount.get(row.id) as { n: number }).n),
    };
  };

  const get = (id: number) => {
    const row = jobById.get(id) as JobRow | undefined;
    return row ? toJob(row) : undefined;
  };

  const log = (id: number, kind: Activity["kind"], at = now()) => insertEvent.run(id, kind, at.toISOString());

  /** Blockers checked: unique, at most MAX_BLOCKERS, each an existing task that has not failed or been stopped. */
  function checkBlockers(raw: readonly number[], self?: number): number[] {
    const ids = [...new Set(raw)];
    if (ids.length > MAX_BLOCKERS) throw new HelperError(`A task can wait for at most ${MAX_BLOCKERS} others.`);
    for (const id of ids) {
      if (id === self) throw new HelperError("A task cannot wait for itself.");
      const blocker = get(id);
      if (!blocker) throw new HelperError(`There is no task ${id} to wait for.`);
      if (blocker.state === "failed" || blocker.state === "stopped") throw new HelperError(`Task ${id} has ${blocker.state === "failed" ? "failed" : "been stopped"}; nothing can wait for it.`);
    }
    return ids;
  }

  function mustHelper(helper: string) {
    const known = findHelper(helper);
    if (!known) throw new HelperError(`There is no helper called "${helper.slice(0, 40)}".`);
    return known;
  }

  const current = (helper: HelperId) => latestSoul.get(helper) as unknown as SoulRow;

  function newSoulVersion(helper: HelperId, soul: Soul) {
    const version = current(helper).version + 1;
    putSoul(helper, version, soul);
    emit({ action: "soul", helper, version });
  }

  function mustGet(id: number): Job {
    const job = get(id);
    if (!job) throw new HelperError(`There is no job ${id}.`);
    return job;
  }

  /**
   * Moves a job to a new state through the state machine, saves it and tells listeners. A task that fails or is
   * stopped fails the queued tasks waiting for it (ADR-087): they could never start.
   */
  function transition(job: Job, to: JobState, fields: { partial?: boolean; error?: string } = {}) {
    move(job.state, to);
    const ended = isFinal(to) ? now() : undefined;
    setState.run(to, fields.partial ? 1 : 0, fields.error ?? null, ended?.toISOString() ?? null, job.id);
    log(job.id, to, ended);
    emit({ action: "job", helper: job.helper, job: job.id, state: to, ...(ended ? { ms: ended.getTime() - job.createdAt.getTime() } : {}) });
    if (to !== "failed" && to !== "stopped") return;
    for (const { id } of dependents.all(job.id) as { id: number }[]) {
      const waiting = get(id);
      if (waiting?.state === "queued") transition(waiting, "failed", { error: `Task ${job.id}, which it waited for, ${to === "failed" ? "failed" : "was stopped"}.` });
    }
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
        name: current(h.id).name,
        available: h.available,
        role: h.role,
        soul: toSoul(current(h.id)),
        soulVersion: current(h.id).version,
        soulVersions: (soulVersions.all(h.id, SOUL_VERSIONS_LISTED) as { version: number; created_at: string }[]).map((v) => ({
          version: v.version,
          createdAt: new Date(v.created_at),
        })),
        app: (appOf.get(h.id) as { app: string } | undefined)?.app ?? null,
        pinnedModel: (pinOf.get(h.id) as { model: string } | undefined)?.model ?? null,
        jobs: (newestJobs.all(h.id, JOBS_PER_HELPER) as unknown as JobRow[]).map(toJob),
      }));
    },

    setApp(helper, app) {
      const known = mustHelper(helper);
      if (app) putApp.run(known.id, app);
      else dropApp.run(known.id);
      emit({ action: "app", helper: known.id });
    },

    pin(helper, model) {
      const known = mustHelper(helper);
      if (model) putPin.run(known.id, model);
      else dropPin.run(known.id);
      emit({ action: "pin", helper: known.id });
    },

    soul(helper) {
      return toSoul(current(mustHelper(helper).id));
    },

    saveSoul(helper, input) {
      const known = mustHelper(helper);
      const others = HELPERS.filter((h) => h.id !== known.id).map((h) => current(h.id).name);
      const soul = cleanSoul(input, others);
      if (!sameSoul(soul, toSoul(current(known.id)))) newSoulVersion(known.id, soul);
    },

    restoreSoul(helper, version) {
      const known = mustHelper(helper);
      const row = soulRow.get(known.id, version) as SoulRow | undefined;
      if (!row) throw new HelperError(`${current(known.id).name} has no version ${version}.`);
      if (row.version === current(known.id).version) return;
      // The old name may have been taken by another worker since.
      const others = HELPERS.filter((h) => h.id !== known.id).map((h) => current(h.id).name);
      newSoulVersion(known.id, cleanSoul(toSoul(row), others));
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

    addJob(helper, raw, options = {}) {
      const known = mustHelper(helper);
      if (!known.available) throw new HelperError(`${current(known.id).name} is not ready yet.`);
      const task = raw.trim();
      if (!task) throw new HelperError("The job is empty.");
      if (task.length > MAX_TASK_CHARS) throw new HelperError(`The job is too long (${task.length} characters, limit ${MAX_TASK_CHARS}).`);
      const goal = options.goal?.trim() || null;
      if (goal && goal.length > MAX_GOAL_CHARS) throw new HelperError(`The goal is too long (${goal.length} characters, limit ${MAX_GOAL_CHARS}).`);
      if (options.parentId !== undefined && !get(options.parentId)) throw new HelperError(`There is no task ${options.parentId}.`);
      // A new task cannot close a circle: everything it waits for already exists.
      const blockers = checkBlockers(options.blockedBy ?? []);
      let id = 0;
      const created = now();
      transaction(() => {
        id = Number(insertJob.run(known.id, task, created.toISOString(), goal, options.parentId ?? null).lastInsertRowid);
        for (const b of blockers) insertBlocker.run(id, b);
        log(id, "created", created);
      });
      emit({ action: "job", helper: known.id, job: id, state: "queued" });
      return mustGet(id);
    },

    setBlockers(id, raw) {
      const job = mustGet(id);
      if (job.state !== "queued") throw new HelperError("Only a task that has not started can change what it waits for.");
      const blockers = checkBlockers(raw, id);
      const edges = new Map<number, number[]>();
      for (const { job_id, blocker_id } of allBlockers.all() as { job_id: number; blocker_id: number }[]) {
        if (job_id !== id) edges.set(job_id, [...(edges.get(job_id) ?? []), blocker_id]);
      }
      if (makesCycle(edges, id, blockers)) throw new HelperError("That would make tasks wait for each other in a circle.");
      transaction(() => {
        clearBlockers.run(id);
        for (const b of blockers) insertBlocker.run(id, b);
        log(id, "waits");
      });
      emit({ action: "blockers", helper: job.helper, job: id });
    },

    addComment(id, raw) {
      const job = mustGet(id);
      const text = raw.trim();
      if (!text) throw new HelperError("The note is empty.");
      if (text.length > MAX_COMMENT_CHARS) throw new HelperError(`The note is too long (${text.length} characters, limit ${MAX_COMMENT_CHARS}).`);
      transaction(() => {
        insertComment.run(id, text, now().toISOString());
        log(id, "commented");
      });
      emit({ action: "comment", helper: job.helper, job: id });
    },

    thread(id) {
      if (!get(id)) return undefined;
      const report = this.report(id);
      return {
        id,
        comments: (commentsOf.all(id) as { id: number; text: string; created_at: string }[]).map((c) => ({ id: c.id, text: c.text, createdAt: new Date(c.created_at) })),
        activity: (eventsOf.all(id) as { kind: Activity["kind"]; at: string }[]).map((e) => ({ kind: e.kind, at: new Date(e.at) })),
        ...(report ? { report } : {}),
      };
    },

    context(id) {
      const job = mustGet(id);
      return {
        ...(job.goal ? { goal: job.goal } : {}),
        comments: (commentsOf.all(id) as { text: string }[]).map((c) => c.text),
        earlier: job.blockedBy.flatMap((b) => {
          const blocker = get(b);
          const report = this.report(b);
          if (!blocker || !report) return [];
          return [{ worker: current(blocker.helper).name, task: blocker.task, title: report.title, summary: report.summary, body: report.body, sources: report.sources }];
        }),
      };
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
        dropLinks.run(id, id);
        deleteComments.run(id);
        deleteEvents.run(id);
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
      const job = mustGet(id);
      move(job.state, "running"); // refuses anything but a queued task, with the usual words
      if (job.waitingFor.length) throw new HelperError(`Task ${id} still waits for ${job.waitingFor.join(", ")}.`);
      // The claim itself: only one caller can move it from queued.
      if (Number(claim.run(id).changes) === 0) throw new HelperError(`Task ${id} has already started.`);
      log(id, "running");
      emit({ action: "job", helper: job.helper, job: id, state: "running" });
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
      const job = mustGet(id);
      // Only a run fails here; a queued task fails only when what it waits for does (in transition).
      if (job.state !== "running") throw new HelperError(`A ${job.state} job cannot become failed.`);
      transition(job, "failed", { partial, error });
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
