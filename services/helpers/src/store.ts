import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_PLAN_LIMIT, DEFAULT_TEAM_CAP, DEFAULT_WORKER_CAP, MAX_CAP, PLAN_LIMIT_RANGE, startOfDay, type Budget, type Budgets } from "./budgets.ts";
import { createSchema, sameSoul, toJobRow, toSoul, webSources, type JobRow, type ReportRow, type SoulRow } from "./store-schema.ts";
import {
  HELPERS,
  HelperError,
  MAX_BLOCKERS,
  MAX_GOAL_TASKS,
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
  goalId?: number;
  /** Its goal has ended and has its combined report (Task 3.5). */
  goalEnded?: boolean;
  /** Task 3.6: its next run continues the last one's Claude session (until "Start fresh"). */
  resumable: boolean;
  /** Asked again while running: one more run follows this one. */
  wakePending: boolean;
  /** Task 3.8: its first run only plans; the plan waits for Keshab ("awaiting"), then goes to the next run ("approved"). */
  planFirst: boolean;
  planStatus?: "awaiting" | "approved";
  /** The plan in one sentence, once written. */
  planSummary?: string;
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
  kind: "created" | "waits" | "commented" | "woken" | "fresh" | "planned" | "approved" | "rejected" | JobState;
  at: Date;
}

/** A task's thread (ADR-087): Keshab's notes, what happened, and the report. */
export interface Thread {
  id: number;
  comments: Comment[];
  activity: Activity[];
  report?: Report;
  /** Task 3.8: the plan, once a plan-first run has written it. */
  plan?: { summary: string; steps: string };
}

/** A goal's combined report (ADR-087, Task 3.5), written when all its tasks have ended. */
export interface GoalReport {
  title: string;
  summary: string;
  body: string;
  sources: Source[];
}

/** What Wisp hands the team in one go (Task 3.5): a goal and its tasks. */
export interface Goal {
  id: number;
  text: string;
  createdAt: Date;
  /** Set when its tasks had all ended and the combined report (if any task was done) was saved. */
  endedAt?: Date;
  tasks: Job[];
  report?: GoalReport;
}

/** One task of a new goal. `after` holds the positions (1 = first) of earlier tasks of the same goal it waits for. */
export interface GoalPart {
  helper: string;
  task: string;
  after?: readonly number[];
}

export interface AddJobOptions {
  /** Tasks this one waits for: each must exist and must not have failed or been stopped. */
  blockedBy?: readonly number[];
  goal?: string;
  parentId?: number;
  /** Task 3.8: plan first; default the worker's setting. */
  planFirst?: boolean;
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
  /** Task 3.7: its daily cap and today's spend. */
  budget: Budget;
  /** Task 3.8: its new tasks plan first. */
  planFirst: boolean;
  /** Newest first, at most JOBS_PER_HELPER. */
  jobs: Job[];
}

/** What changed, for logs and updates: ids, states and timings only. */
export type HelperChange =
  | { action: "app"; helper: HelperId }
  | { action: "pin"; helper: HelperId }
  | { action: "soul"; helper: HelperId; version: number }
  | { action: "settings" }
  | { action: "budget"; helper: HelperId | "team" }
  | { action: "spend"; helper: HelperId; job: number }
  | { action: "plan"; helper: HelperId; job: number; status: "awaiting" | "approved" | "rejected" }
  | { action: "model"; helper: HelperId; job: number }
  | { action: "job"; helper: HelperId; job: number; state: JobState; ms?: number }
  | { action: "step"; helper: HelperId; job: number }
  | { action: "comment"; helper: HelperId; job: number }
  | { action: "blockers"; helper: HelperId; job: number }
  | { action: "deleted"; helper: HelperId; job: number }
  | { action: "goal"; goal: number; tasks: number; ended: boolean };

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
  /** Task 3.7: every cap and today's spend, and the plan limit. */
  budgets(): Budgets;
  /** Sets a worker's or the team's daily cap in dollars (null: no cap). Throws HelperError for an unknown worker or a bad amount. */
  setBudget(helper: string, cap: number | null): void;
  /** Sets the plan's five-hour use (percent) above which new runs wait. Throws HelperError outside 10 to 100. */
  setPlanLimit(percent: number): void;
  /** Records what a run of a task cost (dollars of API-equivalent use). Nothing for an unknown task or a bad amount. */
  addSpend(id: number, dollars: number): void;
  /** Task 3.8: whether a worker's new tasks plan first. Throws HelperError for an unknown worker. */
  setPlanFirst(helper: string, on: boolean): void;
  /** For the runner: a plan-first run's plan. The task goes back to "to do", held until Keshab approves. */
  savePlan(id: number, plan: { summary: string; steps: string }): void;
  /** Approves a task's waiting plan, so its next run does the job with it. Throws HelperError when no plan waits. */
  approvePlan(id: number): void;
  /** Rejects a task's waiting plan: the task is stopped. Throws HelperError when no plan waits. */
  rejectPlan(id: number): void;
  setAllowLarge(allowed: boolean): void;
  /** Records a running job's model and why. False (and nothing saved) unless the job is running. */
  setModel(id: number, model: string, reason: string): boolean;
  /** Queues a job. Throws HelperError for an unknown or unavailable helper, an empty or long task, or bad blockers. */
  addJob(helper: string, task: string, options?: AddJobOptions): Job;
  get(id: number): Job | undefined;
  /**
   * Creates a goal and its tasks in one go (Task 3.5), or nothing: throws HelperError for an empty or long goal, no
   * tasks or more than MAX_GOAL_TASKS, a bad task, or an `after` that is not an earlier task of the goal.
   */
  addGoal(text: string, parts: readonly GoalPart[]): Goal;
  goal(id: number): Goal | undefined;
  /** Ends a goal, with its combined report or null when no task was done. Throws HelperError for an unknown or ended goal. */
  endGoal(id: number, report: GoalReport | null): void;
  /** Every queued job whose blockers are all done, oldest first (for the job runner). */
  queued(): Job[];
  /** Changes what a queued task waits for. Throws HelperError for a task that is not queued, bad blockers, or a circle. */
  setBlockers(id: number, blockedBy: readonly number[]): void;
  /**
   * Adds Keshab's note to a task and wakes it (Task 3.6): an ended task runs again; a running one runs once more when
   * it ends (several notes meanwhile make one more run); a queued one gets the note in its brief. Throws HelperError
   * for an unknown task or an empty or long note.
   */
  addComment(id: number, text: string): void;
  /** Forgets a task's Claude session; an ended task runs again, fresh. Throws HelperError for an unknown or running task. */
  startFresh(id: number): void;
  /** Keeps the session a run used, so the next run resumes it. False (nothing saved) for an unknown task. */
  setSession(id: number, sessionId: string): boolean;
  /** How the next run continues: the session to resume and the notes added since the last run started. */
  resumeOf(id: number): { sessionId: string; notes: string[] } | undefined;
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

export { webSources } from "./store-schema.ts";

export function openHelperStore(options: HelperStoreOptions): HelperStore {
  const { path, now = () => new Date() } = options;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  createSchema(db);
  const opened = now();
  // A job cannot outlive the process that ran it.
  db.prepare("UPDATE jobs SET state = 'failed', step = NULL, error = ?, ended_at = ?, wake_pending = 0 WHERE state = 'running'").run(
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
  const insertSpend = db.prepare("INSERT INTO spend (job_id, helper, dollars, at) VALUES (?, ?, ?, ?)");
  const spentSince = db.prepare("SELECT helper, SUM(dollars) AS total FROM spend WHERE at >= ? GROUP BY helper");
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
  const claim = db.prepare(
    // The notes this run sees, and (from the run before) where the notes new to this run begin.
    "UPDATE jobs SET state = 'running', step = NULL, brief_from = seen_comments, seen_comments = (SELECT COUNT(*) FROM job_comments WHERE job_id = jobs.id) WHERE id = ? AND state = 'queued'",
  );
  const requeue = db.prepare("UPDATE jobs SET state = 'queued', step = NULL, partial = 0, error = NULL, ended_at = NULL, wake_pending = 0 WHERE id = ?");
  const setPending = db.prepare("UPDATE jobs SET wake_pending = ? WHERE id = ?");
  const putSession = db.prepare("UPDATE jobs SET session_id = ? WHERE id = ?");
  const putPlan = db.prepare(
    "UPDATE jobs SET state = 'queued', step = NULL, wake_pending = 0, plan = ?, plan_summary = ?, plan_status = 'awaiting' WHERE id = ? AND state = 'running'",
  );
  const setPlanStatus = db.prepare("UPDATE jobs SET plan_status = ? WHERE id = ? AND plan_status = 'awaiting'");
  const reopenGoal = db.prepare("UPDATE goals SET ended_at = NULL WHERE id = ?");
  const jobById = db.prepare("SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.id = ?");
  const insertJob = db.prepare(
    "INSERT INTO jobs (helper, task, state, created_at, goal, parent_id, goal_id, plan_first) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)",
  );
  const planFirstOf = (helper: HelperId) => (settingOf.get(`planFirst:${helper}`) as { value: string } | undefined)?.value === "true";
  const insertGoal = db.prepare("INSERT INTO goals (text, created_at) VALUES (?, ?)");
  const goalRow = db.prepare("SELECT * FROM goals WHERE id = ?");
  const goalEndedAt = db.prepare("SELECT ended_at FROM goals WHERE id = ?");
  const goalTasks = db.prepare("SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.goal_id = ? ORDER BY j.id");
  const closeGoal = db.prepare("UPDATE goals SET ended_at = ?, report = ? WHERE id = ? AND ended_at IS NULL");
  const setState = db.prepare("UPDATE jobs SET state = ?, step = NULL, partial = ?, error = ?, ended_at = ?, wake_pending = 0 WHERE id = ?");
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
    const goalEnded = row.goal_id != null && Boolean((goalEndedAt.get(row.goal_id) as { ended_at: string | null } | undefined)?.ended_at);
    return {
      ...toJobRow(row),
      ...(goalEnded ? { goalEnded } : {}),
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

  function availableHelper(helper: string) {
    const known = mustHelper(helper);
    if (!known.available) throw new HelperError(`${current(known.id).name} is not ready yet.`);
    return known;
  }

  function cleanTask(raw: string): string {
    const task = raw.trim();
    if (!task) throw new HelperError("The job is empty.");
    if (task.length > MAX_TASK_CHARS) throw new HelperError(`The job is too long (${task.length} characters, limit ${MAX_TASK_CHARS}).`);
    return task;
  }

  /** Inserts a checked task with its blockers; call inside a transaction. */
  function insertTask(
    helper: HelperId,
    task: string,
    blockers: readonly number[],
    links: { goal: string | null; parentId: number | null; goalId: number | null; planFirst?: boolean },
  ): number {
    const created = now();
    const planFirst = links.planFirst ?? planFirstOf(helper) ? 1 : 0;
    const id = Number(insertJob.run(helper, task, created.toISOString(), links.goal, links.parentId, links.goalId, planFirst).lastInsertRowid);
    for (const b of blockers) insertBlocker.run(id, b);
    log(id, "created", created);
    return id;
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
    const pending = to !== "stopped" && get(job.id)?.wakePending === true;
    const ended = isFinal(to) ? now() : undefined;
    setState.run(to, fields.partial ? 1 : 0, fields.error ?? null, ended?.toISOString() ?? null, job.id);
    log(job.id, to, ended);
    emit({ action: "job", helper: job.helper, job: job.id, state: to, ...(ended ? { ms: ended.getTime() - job.createdAt.getTime() } : {}) });
    // Asked again while it ran: one more run, instead of failing what waits for it.
    if (pending) return wake(get(job.id)!);
    if (to !== "failed" && to !== "stopped") return;
    for (const { id } of dependents.all(job.id) as { id: number }[]) {
      const waiting = get(id);
      if (waiting?.state === "queued") transition(waiting, "failed", { error: `Task ${job.id}, which it waited for, ${to === "failed" ? "failed" : "was stopped"}.` });
    }
  }

  /** Task 3.6: an ended task runs again (its goal opens again); a running one runs once more when it ends. */
  function wake(job: Job) {
    if (job.state === "running") {
      setPending.run(1, job.id);
      return;
    }
    if (!isFinal(job.state)) return;
    requeue.run(job.id);
    if (job.goalId !== undefined) reopenGoal.run(job.goalId);
    log(job.id, "woken");
    emit({ action: "job", helper: job.helper, job: job.id, state: "queued" });
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
      const budgets = this.budgets();
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
        budget: budgets.workers[h.id],
        planFirst: planFirstOf(h.id),
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

    budgets() {
      const since = startOfDay(now()).toISOString();
      const spent = new Map((spentSince.all(since) as { helper: string; total: number }[]).map((r) => [r.helper, r.total]));
      const cap = (key: string, fallback: number) => {
        const value = (settingOf.get(key) as { value: string } | undefined)?.value;
        return value === undefined ? fallback : value === "none" ? null : Number(value);
      };
      const workers = Object.fromEntries(HELPERS.map((h) => [h.id, { cap: cap(`budget:${h.id}`, DEFAULT_WORKER_CAP), spent: spent.get(h.id) ?? 0 }])) as Budgets["workers"];
      const team = { cap: cap("budget:team", DEFAULT_TEAM_CAP), spent: [...spent.values()].reduce((a, b) => a + b, 0) };
      return { team, workers, planLimit: cap("planLimit", DEFAULT_PLAN_LIMIT) ?? 100 };
    },

    setBudget(helper, cap) {
      const who = helper === "team" ? "team" : mustHelper(helper).id;
      if (cap !== null && !(Number.isFinite(cap) && cap > 0 && cap <= MAX_CAP)) throw new HelperError(`A daily budget is more than $0 and at most $${MAX_CAP}.`);
      putSetting.run(`budget:${who}`, cap === null ? "none" : String(cap));
      emit({ action: "budget", helper: who });
    },

    setPlanLimit(percent) {
      const [low, high] = PLAN_LIMIT_RANGE;
      if (!Number.isInteger(percent) || percent < low || percent > high) throw new HelperError(`The plan limit is a whole percent from ${low} to ${high}.`);
      putSetting.run("planLimit", String(percent));
      emit({ action: "budget", helper: "team" });
    },

    setPlanFirst(helper, on) {
      const known = mustHelper(helper);
      putSetting.run(`planFirst:${known.id}`, String(on));
      emit({ action: "settings" });
    },

    savePlan(id, plan) {
      const job = mustGet(id);
      if (Number(putPlan.run(plan.steps, plan.summary, id).changes) === 0) throw new HelperError(`A ${job.state} job cannot save a plan.`);
      log(id, "planned");
      emit({ action: "plan", helper: job.helper, job: id, status: "awaiting" });
      emit({ action: "job", helper: job.helper, job: id, state: "queued" });
    },

    approvePlan(id) {
      const job = mustGet(id);
      if (job.state !== "queued" || Number(setPlanStatus.run("approved", id).changes) === 0) throw new HelperError("No plan waits for your OK on that task.");
      log(id, "approved");
      emit({ action: "plan", helper: job.helper, job: id, status: "approved" });
    },

    rejectPlan(id) {
      const job = mustGet(id);
      if (job.planStatus !== "awaiting" || job.state !== "queued") throw new HelperError("No plan waits for your OK on that task.");
      log(id, "rejected");
      emit({ action: "plan", helper: job.helper, job: id, status: "rejected" });
      transition(job, "stopped");
    },

    addSpend(id, dollars) {
      const job = get(id);
      if (!job || !Number.isFinite(dollars) || dollars <= 0) return;
      insertSpend.run(id, job.helper, dollars, now().toISOString());
      emit({ action: "spend", helper: job.helper, job: id });
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
      const known = availableHelper(helper);
      const task = cleanTask(raw);
      const goal = options.goal?.trim() || null;
      if (goal && goal.length > MAX_GOAL_CHARS) throw new HelperError(`The goal is too long (${goal.length} characters, limit ${MAX_GOAL_CHARS}).`);
      if (options.parentId !== undefined && !get(options.parentId)) throw new HelperError(`There is no task ${options.parentId}.`);
      // A new task cannot close a circle: everything it waits for already exists.
      const blockers = checkBlockers(options.blockedBy ?? []);
      let id = 0;
      transaction(() => (id = insertTask(known.id, task, blockers, { goal, parentId: options.parentId ?? null, goalId: null, planFirst: options.planFirst })));
      emit({ action: "job", helper: known.id, job: id, state: "queued" });
      return mustGet(id);
    },

    addGoal(raw, parts) {
      const text = raw.trim();
      if (!text) throw new HelperError("The goal is empty.");
      if (text.length > MAX_GOAL_CHARS) throw new HelperError(`The goal is too long (${text.length} characters, limit ${MAX_GOAL_CHARS}).`);
      if (!parts.length || parts.length > MAX_GOAL_TASKS) throw new HelperError(`A goal has 1 to ${MAX_GOAL_TASKS} tasks.`);
      // Everything is checked before anything is written; `after` points back only, so a goal can never be a circle.
      const checked = parts.map((part, i) => {
        const after = [...new Set(part.after ?? [])];
        const bad = after.find((n) => !Number.isInteger(n) || n < 1 || n > i);
        if (bad !== undefined) throw new HelperError(`Task ${i + 1} can only wait for tasks before it, not ${bad}.`);
        if (after.length > MAX_BLOCKERS) throw new HelperError(`A task can wait for at most ${MAX_BLOCKERS} others.`);
        return { helper: availableHelper(part.helper).id, task: cleanTask(part.task), after };
      });
      let goalId = 0;
      const ids: number[] = [];
      transaction(() => {
        goalId = Number(insertGoal.run(text, now().toISOString()).lastInsertRowid);
        for (const part of checked) ids.push(insertTask(part.helper, part.task, part.after.map((n) => ids[n - 1]!), { goal: text, parentId: null, goalId }));
      });
      emit({ action: "goal", goal: goalId, tasks: ids.length, ended: false });
      ids.forEach((id, i) => emit({ action: "job", helper: checked[i]!.helper, job: id, state: "queued" }));
      return this.goal(goalId)!;
    },

    goal(id) {
      const row = goalRow.get(id) as { id: number; text: string; created_at: string; ended_at: string | null; report: string | null } | undefined;
      if (!row) return undefined;
      return {
        id: row.id,
        text: row.text,
        createdAt: new Date(row.created_at),
        ...(row.ended_at ? { endedAt: new Date(row.ended_at) } : {}),
        tasks: (goalTasks.all(id) as unknown as JobRow[]).map(toJob),
        ...(row.report ? { report: JSON.parse(row.report) as GoalReport } : {}),
      };
    },

    endGoal(id, report) {
      const goal = this.goal(id);
      if (!goal) throw new HelperError(`There is no goal ${id}.`);
      const saved = report && { ...report, sources: webSources(report.sources).map((s) => ({ title: s.title, url: s.url })) };
      if (Number(closeGoal.run(now().toISOString(), saved ? JSON.stringify(saved) : null, id).changes) === 0) throw new HelperError(`Goal ${id} has already ended.`);
      emit({ action: "goal", goal: id, tasks: goal.tasks.length, ended: true });
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
      wake(job);
    },

    startFresh(id) {
      const job = mustGet(id);
      if (job.state === "running") throw new HelperError("Wait for the run to end, or stop it, before starting fresh.");
      putSession.run(null, id);
      log(id, "fresh");
      emit({ action: "comment", helper: job.helper, job: id });
      wake(job);
    },

    setSession(id, sessionId) {
      const job = get(id);
      if (!job) return false;
      putSession.run(sessionId, id);
      return true;
    },

    resumeOf(id) {
      const row = jobById.get(id) as JobRow | undefined;
      if (!row?.session_id) return undefined;
      const notes = (commentsOf.all(id) as { text: string }[]).map((c) => c.text).slice(row.state === "running" ? (row.brief_from ?? 0) : (row.seen_comments ?? 0));
      return { sessionId: row.session_id, notes };
    },

    thread(id) {
      if (!get(id)) return undefined;
      const report = this.report(id);
      const row = jobById.get(id) as unknown as JobRow;
      return {
        id,
        ...(row.plan && row.plan_summary ? { plan: { summary: row.plan_summary, steps: row.plan } } : {}),
        comments: (commentsOf.all(id) as { id: number; text: string; created_at: string }[]).map((c) => ({ id: c.id, text: c.text, createdAt: new Date(c.created_at) })),
        activity: (eventsOf.all(id) as { kind: Activity["kind"]; at: string }[]).map((e) => ({ kind: e.kind, at: new Date(e.at) })),
        ...(report ? { report } : {}),
      };
    },

    context(id) {
      const job = mustGet(id);
      const row = jobById.get(id) as unknown as JobRow;
      return {
        ...(job.goal ? { goal: job.goal } : {}),
        ...(job.planStatus === "approved" && row.plan ? { plan: row.plan } : {}),
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
