import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { MAX_GRANTS, checkGrant } from "./grants.ts";
import { KITS, MAX_AGENTS, RESERVED_AGENT_IDS, agentId, cleanRole, loadAgents, retireAgent, writeAgent, type AgentProblem, type Kit } from "./agents.ts";

/** Task 3.12: most skills a worker may have. */
export const MAX_SKILLS = 10;
import { routineTable } from "./routines.ts";
import { SOUL_FIELDS, proposalTable } from "./feedback.ts";
import { skillStore } from "./skill-drafts.ts";
import { skillHubStore } from "./skill-hub.ts";
import { mcpTable } from "./mcp.ts";
import { usageTable } from "./usage.ts";
import { toolCallTable } from "./tool-calls.ts";
import { planTable, viewOfPlan, type StoredPlan } from "./plans.ts";
import { auditTable } from "./audit.ts";
import { checkpointTable } from "./checkpoints.ts";
import { searchTable } from "./search.ts";
import { MAX_TEST_CASES, TEST_CASES_RUN, skillInstructions, testCaseTable, type TestKind } from "./test-cases.ts";
import { routineMethods } from "./store-routines.ts";
import { soulMethods } from "./store-souls.ts";
import { noteMethods } from "./store-notes.ts";
import { mcpMethods } from "./store-mcp.ts";
import { testCaseMethods } from "./store-testcases.ts";
import { planMethods } from "./store-plans.ts";
import { checkpointMethods } from "./store-checkpoints.ts";
import { type Member, type StoreContext } from "./store-context.ts";
import { createSchema, sameSoul, toJobRow, toSoul, webSources, type JobRow, type ReportRow, type SoulRow } from "./store-schema.ts";
import {
  BUILT_IN_KITS,
  HELPERS,
  HelperError,
  MAX_AUTO_RETRIES,
  isRetryable,
  MAX_BLOCKERS,
  cleanSoul,
  instructionsFor,
  isFinal,
  makesCycle,
  move,
  type HelperId,
  type JobState,
  type Soul,
} from "./jobs.ts";

// ADR-081: helper apps, jobs and reports in one local SQLite file. Task text, reports and source addresses
// are the user's own: kept here, never logged (callers log the change events, which carry ids and states only).

export const JOBS_PER_HELPER = 20;
export const CLOSED_WHILE_RUNNING = "ATOM closed before this attempt's outcome was confirmed. Files may already have changed. Review the last step, tool history and file changes before trying again.";
/** Soul versions listed per worker (all are kept). */
export const SOUL_VERSIONS_LISTED = 10;

export type * from "./store-types.ts";
import type { Activity, GoalReport, HelperChange, HelperStore, HelperStoreOptions, Job, PlanView, Source } from "./store-types.ts";

export { webSources } from "./store-schema.ts";

export function openHelperStore(options: HelperStoreOptions): HelperStore {
  const { path, now = () => new Date(), home = homedir(), agentsDir, skillsDir, checkpointsDir } = options;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  createSchema(db);
  const opened = now();
  // A job cannot outlive the process that ran it.
  db.exec("BEGIN");
  try {
    db.exec("UPDATE jobs SET retry_next = (SELECT child.id FROM jobs child WHERE child.retry_of = jobs.id) WHERE retry_next IS NULL AND EXISTS (SELECT 1 FROM jobs child WHERE child.retry_of = jobs.id)");
    db.prepare("UPDATE jobs SET recovery_needed = 1, error = ? WHERE state = 'failed' AND error = 'ATOM was closed while this job ran' AND recovery_needed IS NULL").run(CLOSED_WHILE_RUNNING);
    db.prepare("INSERT INTO job_events(job_id, kind, at) SELECT id, 'interrupted', ? FROM jobs WHERE state = 'running' OR (state = 'queued' AND retry_of IS NOT NULL)").run(opened.toISOString());
    db.prepare("UPDATE jobs SET state = 'failed', recovery_needed = 1, error = CASE WHEN native_scope = 'advisory' THEN 'ATOM closed before this advisory report completed. Request another review from its parent; this child cannot be retried on its own.' ELSE ? END, ended_at = ?, wake_pending = 0 WHERE state = 'running' OR (state = 'queued' AND retry_of IS NOT NULL)").run(CLOSED_WHILE_RUNNING, opened.toISOString());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); db.close(); throw error; }

  const appOf = db.prepare("SELECT app FROM helper_apps WHERE helper = ?");
  const putApp = db.prepare("INSERT INTO helper_apps (helper, app) VALUES (?, ?) ON CONFLICT (helper) DO UPDATE SET app = excluded.app");
  const dropApp = db.prepare("DELETE FROM helper_apps WHERE helper = ?");
  const pinOf = db.prepare("SELECT model FROM helper_models WHERE helper = ?");
  const putPin = db.prepare("INSERT INTO helper_models (helper, model) VALUES (?, ?) ON CONFLICT (helper) DO UPDATE SET model = excluded.model");
  const dropPin = db.prepare("DELETE FROM helper_models WHERE helper = ?");
  const codexPinOf = db.prepare("SELECT model FROM helper_codex_models WHERE helper = ?");
  const putCodexPin = db.prepare("INSERT INTO helper_codex_models (helper, model) VALUES (?, ?) ON CONFLICT (helper) DO UPDATE SET model = excluded.model");
  const dropCodexPin = db.prepare("DELETE FROM helper_codex_models WHERE helper = ?");
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

  const builtIns: Member[] = HELPERS.map((h) => ({ id: h.id, available: h.available as boolean, role: h.role, kit: BUILT_IN_KITS[h.role] ?? "think", custom: false }));
  let rosterProblems: AgentProblem[] = [];

  /** A file's soul is the current one: when it differs from the last version kept here, it becomes a new version. */
  function keepSoul(id: string, soul: Soul) {
    const last = latestSoul.get(id) as unknown as SoulRow | undefined;
    if (!last) putSoul(id, 1, soul);
    else if (!sameSoul(toSoul(last), soul)) {
      putSoul(id, last.version + 1, soul);
      emit({ action: "soul", helper: id, version: last.version + 1 });
    }
  }

  /**
   * The team: the built-in workers, then every agent folder with a valid soul.md. An agent's file is its current
   * soul: when it differs from the last version kept here, it becomes a new version (so edits in an editor are kept).
   * ADR-110 N5: Manager files (`kind: manager`) are no longer read.
   */
  function roster(): Member[] {
    if (!agentsDir) return builtIns;
    const { agents, problems } = loadAgents(agentsDir);
    rosterProblems = [...problems];
    const names = builtIns.map((m) => current(m.id).name);
    const problem = (id: string, error: unknown) => rosterProblems.push({ id, problem: error instanceof Error ? error.message : String(error) });
    const members = [...builtIns];
    for (const agent of agents) {
      if (members.some((m) => m.id === agent.id)) continue;
      let soul: Soul;
      let role: string;
      try {
        role = cleanRole(agent.role || "assistant");
        soul = cleanSoul(agent.soul, names);
      } catch (error) {
        problem(agent.id, error);
        continue;
      }
      keepSoul(agent.id, soul);
      names.push(soul.name);
      members.push({ id: agent.id, available: true, role, kit: agent.kit, custom: true, ...(agent.manager ? { manager: agent.manager } : {}) });
    }
    return members;
  }

  /** Keeps a custom agent's soul.md in step after a save, restore or accepted proposal (its old Manager field kept as written). */
  function writeBack(member: Member) {
    if (!member.custom || !agentsDir) return;
    writeAgent(agentsDir, { id: member.id, role: member.role, kit: member.kit, soul: toSoul(current(member.id)), ...(member.manager ? { manager: member.manager } : {}) });
  }

  /** Every name in use, and every folder name in the agents folder. */
  const allNames = () => roster().map((m) => current(m.id).name);
  const takenIds = () => [...roster().map((m) => m.id), ...(agentsDir && existsSync(agentsDir) ? readdirSync(agentsDir) : [])];
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
  const insertComment = db.prepare("INSERT INTO job_comments (job_id, text, created_at, delivery) VALUES (?, ?, ?, ?)");
  const commentsOf = db.prepare("SELECT id, text, created_at, delivery FROM job_comments WHERE job_id = ? ORDER BY id");
  // ADR-098 item 3: an interrupted run's task waits for Keshab, unless a note already waits (then it runs again).
  const putInterrupted = db.prepare(
    "UPDATE jobs SET state = 'queued', step = NULL, interrupted = CASE WHEN wake_pending = 1 THEN 0 ELSE 1 END, wake_pending = 0 WHERE id = ? AND state = 'running'",
  );
  const clearInterrupted = db.prepare("UPDATE jobs SET interrupted = 0 WHERE id = ?");
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
  const bumpRetries = db.prepare("UPDATE jobs SET auto_retries = COALESCE(auto_retries, 0) + 1 WHERE id = ?");
  const setPlanStatus = db.prepare("UPDATE jobs SET plan_status = ? WHERE id = ? AND plan_status = 'awaiting'");
  const reopenGoal = db.prepare("UPDATE goals SET ended_at = NULL WHERE id = ?");
  const childrenOf = db.prepare("SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.parent_id = ? ORDER BY j.id");
  const dropBlocker = db.prepare("DELETE FROM job_blockers WHERE job_id = ? AND blocker_id = ?");
  const jobById = db.prepare("SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.id = ?");
  const retryOf = db.prepare("SELECT id FROM jobs WHERE retry_of = ?");
  const retryInChat = db.prepare("SELECT id FROM jobs WHERE chat_id = ? AND retry_of IS NOT NULL");
  const linkRetry = db.prepare("UPDATE jobs SET retry_of = ?, chat_id = ? WHERE id = ?");
  const rememberRetry = db.prepare("UPDATE jobs SET retry_next = ? WHERE id = ?");
  const insertJob = db.prepare(
    "INSERT INTO jobs (helper, task, state, created_at, goal, parent_id, goal_id, plan_first) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)",
  );
  const setNativeLinks = db.prepare("UPDATE jobs SET chat_id = ?, sdk_task_id = ? WHERE id = ?");
  const setNativeTask = db.prepare("UPDATE jobs SET sdk_task_id = ? WHERE id = ?");
  const planFirstOf = (helper: HelperId) => (settingOf.get(`planFirst:${helper}`) as { value: string } | undefined)?.value === "true";
  // ADR-098: whether an agent's runs get the browser (default off).
  const browserOf = (helper: HelperId) => (settingOf.get(`browser:${helper}`) as { value: string } | undefined)?.value === "true";
  const goalRow = db.prepare("SELECT * FROM goals WHERE id = ?");
  const goalEndedAt = db.prepare("SELECT ended_at FROM goals WHERE id = ?");
  const goalTasks = db.prepare("SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.goal_id = ? ORDER BY j.id");
  const setState = db.prepare("UPDATE jobs SET state = ?, step = NULL, partial = ?, error = ?, ended_at = ?, wake_pending = 0 WHERE id = ?");
  const setStep = db.prepare("UPDATE jobs SET step = ? WHERE id = ? AND state = 'running'");
  const insertReport = db.prepare("INSERT OR REPLACE INTO reports (job_id, title, summary, body, sources) VALUES (?, ?, ?, ?, ?)");
  const reportById = db.prepare("SELECT * FROM reports WHERE job_id = ?");
  const deleteJob = db.prepare("DELETE FROM jobs WHERE id = ?");
  const deleteReport = db.prepare("DELETE FROM reports WHERE job_id = ?");

  const routines = routineTable(db);
  const proposals = proposalTable(db);
  const mcp = mcpTable(db);
  const tokens = usageTable(db, now);
  const toolCalls = toolCallTable(db); // B3.1
  const workPlans = planTable(db, now); // ADR-111
  const dropPlanLink = db.prepare("DELETE FROM plan_jobs WHERE job_id = ?"); // a removed task frees its portion (it showed "running" for ever)
  const unlinkParent = db.prepare("UPDATE jobs SET parent_id = NULL WHERE parent_id = ?");
  const checkpoints = checkpointTable(db, checkpointsDir, home); // B3.4
  checkpoints.sweep(opened);
  const finder = searchTable(db); // ADR-098: labels and the window's search
  const tests = testCaseTable(db, now); // ADR-098 item 8
  const putRating = db.prepare("UPDATE jobs SET rating = ?, rating_comment = ? WHERE id = ?");
  // One Tinker task per task and kind (and skill, for edits): a soul review has no kind.
  const tinkerOf = db.prepare("SELECT id FROM jobs WHERE reviews = ? AND COALESCE(review_kind, '') = ? AND COALESCE(review_skill, '') = ? LIMIT 1");
  const insertReview = db.prepare("INSERT INTO jobs (helper, task, state, created_at, reviews, review_kind, review_skill) VALUES ('tinker', ?, 'queued', ?, ?, ?, ?)");
  const grantsOf = db.prepare("SELECT path FROM grants WHERE helper = ? ORDER BY rowid");
  const skillsOf = db.prepare("SELECT skill FROM helper_skills WHERE helper = ? ORDER BY skill");
  const clearSkills = db.prepare("DELETE FROM helper_skills WHERE helper = ?");
  const putSkill = db.prepare("INSERT OR IGNORE INTO helper_skills (helper, skill) VALUES (?, ?)");
  const putGrant = db.prepare("INSERT OR IGNORE INTO grants (helper, path) VALUES (?, ?)");
  const dropGrant = db.prepare("DELETE FROM grants WHERE helper = ? AND path = ?");
  const dropGrants = db.prepare("DELETE FROM grants WHERE helper = ?");
  const dropSouls = db.prepare("DELETE FROM souls WHERE helper = ?");
  const dropRoutines = db.prepare("DELETE FROM routines WHERE helper = ?");
  const openJobsOf = db.prepare("SELECT id FROM jobs WHERE helper = ? AND state IN ('queued', 'running')");
  const listeners = new Set<(change: HelperChange) => void>();
  const audit = auditTable(db, () => new Date()); // docs/v2-plan.md item 9
  const emit = (change: HelperChange) => {
    audit.record(change);
    for (const listener of listeners) listener(change);
  };

  const toJob = (row: JobRow): Job => {
    const blockers = blockersOf.all(row.id) as { id: number; state: string }[];
    const next = row.retry_next != null ? { id: row.retry_next } : retryOf.get(row.id) as { id: number } | undefined;
    const goalEnded = row.goal_id != null && Boolean((goalEndedAt.get(row.goal_id) as { ended_at: string | null } | undefined)?.ended_at);
    return {
      ...toJobRow(row),
      ...(next ? { retriedAs: next.id } : {}),
      ...(goalEnded ? { goalEnded } : {}),
      blockedBy: blockers.map((b) => b.id),
      waitingFor: blockers.filter((b) => b.state !== "done").map((b) => b.id),
      comments: Number((commentCount.get(row.id) as { n: number }).n),
      ...finder.labelsField(row.id),
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
    // Task 3.13: Tinker takes no tasks of its own: it reviews the tasks Keshab rates as not good.
    if (known.role === "improver") throw new HelperError(`${current(known.id).name} only reviews tasks you rate as not good.`);
    if (!(known.available as boolean)) throw new HelperError(`${current(known.id).name} is not ready yet.`);
    return known;
  }

  function cleanTask(raw: string): string {
    const task = raw.trim();
    if (!task) throw new HelperError("The job is empty.");
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
    const known = roster().find((m) => m.id === helper);
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
    if (pending && !job.chatId && !options.retryNative) return wake(get(job.id)!);
    // ADR-090: a failure a second try may fix is retried once by itself, before anything waiting for it fails.
    if (to === "failed" && !job.chatId && !options.retryNative && isRetryable(fields.error) && (get(job.id)?.autoRetries ?? 0) < MAX_AUTO_RETRIES) {
      bumpRetries.run(job.id);
      log(job.id, "retried");
      return wake(get(job.id)!);
    }
    if (to !== "failed" && to !== "stopped") return;
    // ADR-094: a failure a retry does not fix, in a task that used one of ATOM's skills, asks Tinker to improve it.
    if (to === "failed" && job.helper !== "tinker") skills.askEdits(job);
    for (const { id } of dependents.all(job.id) as { id: number }[]) {
      const waiting = get(id);
      if (waiting?.state !== "queued") continue;
      // Task 3.10: a sub-task that did not finish does not fail the task that handed it off: that one runs again without it.
      if (job.parentId === id) {
        dropBlocker.run(id, job.id);
        emit({ action: "blockers", helper: waiting.helper, job: id });
        continue;
      }
      transition(waiting, "failed", { error: `Task ${job.id}, which it waited for, ${to === "failed" ? "failed" : "was stopped"}.` });
    }
  }

  /** Task 3.6: an ended task runs again (its goal opens again); a running one runs once more when it ends. */
  function wake(job: Job) {
    // Native attempts never reuse an old run through legacy comments/auto-wake. Explicit retries get a new identity.
    if (job.chatId || options.retryNative) return;
    if (job.state === "running") {
      setPending.run(1, job.id);
      return;
    }
    // ADR-098 item 3: an interrupted task runs again with Keshab's message, in the same session.
    if (job.interrupted) {
      clearInterrupted.run(job.id);
      log(job.id, "woken");
      emit({ action: "job", helper: job.helper, job: job.id, state: "queued" });
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
  /** Task 3.13, ADR-094: queues one Tinker task about a task; false when that one exists already. */
  function askTinker(jobId: number, task: string, kind: "skill" | "edit" | null, skill: string | null = null): boolean {
    if (tinkerOf.get(jobId, kind ?? "", skill ?? "")) return false;
    let id = 0;
    transaction(() => {
      const at = now();
      id = Number(insertReview.run(task, at.toISOString(), jobId, kind, skill).lastInsertRowid);
      log(id, "created", at);
    });
    emit({ action: "job", helper: "tinker", job: id, state: "queued" });
    return true;
  }

  const hub = skillHubStore({ db, now, ...(skillsDir ? { skillsDir } : {}), userSkillsDir: join(home, ".claude", "skills"), emit }); // B3.5
  const skills = skillStore({
    db,
    now,
    ...(skillsDir ? { skillsDir } : {}),
    userSkillsDir: join(home, ".claude", "skills"),
    isHub: hub.isHubSkill,
    emit,
    get,
    mustGet,
    report: (id) => {
      const row = reportById.get(id) as ReportRow | undefined;
      return row ? { jobId: row.job_id, title: row.title, summary: row.summary, body: row.body, sources: [] } : undefined;
    },
    ratingComment: (id) => (jobById.get(id) as { rating_comment?: string | null } | undefined)?.rating_comment ?? undefined,
    worker: (helper) => ({ name: current(helper).name, role: mustHelper(helper).role }),
    askTinker: (jobId, task, kind, skill) => askTinker(jobId, task, kind, skill ?? null),
  });

  /** ADR-111: a stored plan with the state of each portion, read from the Board jobs. */
  const planView = (stored: StoredPlan): PlanView =>
    viewOfPlan(stored, workPlans.jobs(stored.id), (job) => get(job)?.state, (agent) => (roster().some((m) => m.id === agent) ? current(agent).name : agent));

  // What the method groups in store-routines.ts and store-mcp.ts need from this closure.
  const reportOf: HelperStore["report"] = (id) => {
      const row = reportById.get(id) as ReportRow | undefined;
      if (!row) return undefined;
      return { jobId: row.job_id, title: row.title, summary: row.summary, body: row.body, sources: JSON.parse(row.sources) as Source[] };
  };
  const ctx: StoreContext = {
    now, emit, routines, mcp, roster, availableHelper, cleanTask, get, mustGet, mustHelper, current, report: reportOf, tests, skills, proposals, tinkerOf,
    workPlans, planView, toolCalls, checkpoints, grantsOf, newSoulVersion, writeBack, soulRow, putRating, jobById, askTinker,
    transaction, insertComment, log, wake, finder, tokens, goalRow, goalTasks, toJob,
  };

  return {
    ...routineMethods(ctx),
    ...mcpMethods(ctx),
    ...soulMethods(ctx),
    ...noteMethods(ctx),
    ...testCaseMethods(ctx),
    ...planMethods(ctx),
    ...checkpointMethods(ctx),
    list() {
      return roster().map((h) => {
        const codexModel = (codexPinOf.get(h.id) as { model: string } | undefined)?.model;
        return {
          id: h.id,
          name: current(h.id).name,
          available: h.available,
          role: h.role,
          kit: h.kit,
          custom: h.custom,
          soul: toSoul(current(h.id)),
          soulVersion: current(h.id).version,
          soulVersions: (soulVersions.all(h.id, SOUL_VERSIONS_LISTED) as { version: number; created_at: string }[]).map((v) => ({
            version: v.version,
            createdAt: new Date(v.created_at),
          })),
          app: (appOf.get(h.id) as { app: string } | undefined)?.app ?? null,
          pinnedModel: (pinOf.get(h.id) as { model: string } | undefined)?.model ?? null,
          ...(codexModel ? { codexPinnedModel: codexModel } : {}),
          planFirst: planFirstOf(h.id),
          browser: browserOf(h.id),
          routines: routines.list().filter((r) => r.helper === h.id),
          grants: (grantsOf.all(h.id) as { path: string }[]).map((g) => g.path),
          skills: (skillsOf.all(h.id) as { skill: string }[]).map((s) => s.skill),
          proposals: proposals.list(h.id),
          jobs: (newestJobs.all(h.id, JOBS_PER_HELPER) as unknown as JobRow[]).map(toJob),
        };
      });
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

    pinCodex(helper, model) {
      const known = mustHelper(helper);
      if (model && !/^[A-Za-z0-9._:-]{1,100}$/.test(model)) throw new HelperError("That is not a valid Codex model id.");
      if (model) putCodexPin.run(known.id, model);
      else dropCodexPin.run(known.id);
      emit({ action: "pin", helper: known.id });
    },

    addGrant(helper, path) {
      const known = mustHelper(helper);
      if (known.kit !== "folders") throw new HelperError(`${current(known.id).name} does not work in folders.`);
      const real = checkGrant(path, home);
      if ((grantsOf.all(known.id) as unknown[]).length >= MAX_GRANTS) throw new HelperError(`A worker can have at most ${MAX_GRANTS} folders.`);
      putGrant.run(known.id, real);
      emit({ action: "grant", helper: known.id, granted: true });
    },

    createAgent(input) {
      if (!agentsDir) throw new HelperError("New agents need ATOM's agents folder.");
      const team = roster();
      if (team.filter((m) => m.custom).length >= MAX_AGENTS) throw new HelperError(`There are already ${MAX_AGENTS} agents.`);
      const role = cleanRole(input.role);
      if (!KITS.includes(input.kit)) throw new HelperError("Choose what the agent may use: research, folders or think.");
      const soul = cleanSoul({ name: input.name, personality: input.personality, howItWorks: input.howItWorks ?? "", rules: input.rules ?? "", lessons: "" }, allNames());
      if (RESERVED_AGENT_IDS.includes(agentId(soul.name, []))) throw new HelperError(`"${soul.name}" is the name of one of Claude Code's own agents. Choose another name.`);
      const id = agentId(soul.name, takenIds());
      writeAgent(agentsDir, { id, role, kit: input.kit, soul });
      roster(); // records version 1
      emit({ action: "agent", helper: id, added: true });
      return this.list().find((h) => h.id === id)!;
    },

    removeAgent(id) {
      const member = mustHelper(id);
      if (!member.custom || !agentsDir) throw new HelperError("Only an agent you added can be removed.");
      // Every unfinished task of the agent, not only the newest 20 that list() holds.
      for (const row of openJobsOf.all(id) as { id: number }[]) this.stop(row.id);
      retireAgent(agentsDir, id, now());
      // Nothing of the old agent may pass to a new agent that gets the same id (its folder name): grants, skills, app, pin, souls, routines, MCP access.
      transaction(() => {
        dropGrants.run(id);
        clearSkills.run(id);
        dropApp.run(id);
        dropPin.run(id);
        dropCodexPin.run(id);
        dropSouls.run(id);
        dropRoutines.run(id);
      });
      for (const server of mcp.list()) if (server.workers.includes(id)) mcp.flags(server.id, server.enabled, server.trusted, server.workers.filter((w) => w !== id));
      emit({ action: "agent", helper: id, added: false });
    },

    agentProblems() {
      roster();
      return rosterProblems;
    },

    skillDraftTarget: skills.skillDraftTarget,
    skillEditTarget: skills.skillEditTarget,
    addSkillDraft: skills.addSkillDraft,
    approveSkillDraft: skills.approveSkillDraft,
    rejectSkillDraft: skills.rejectSkillDraft,
    addSkillEdit: skills.addSkillEdit,
    acceptSkillEdit: skills.acceptSkillEdit,
    rejectSkillEdit: skills.rejectSkillEdit,
    undoSkillEdit: skills.undoSkillEdit,
    recordSkillUse: skills.recordSkillUse,
    audit: (limit) => audit.recent(limit),

    proposeSkill: skills.proposeSkill,
    proposeSkillEdit: skills.proposeSkillEdit,

    skillsUsed: skills.skillsUsed,
    skillDrafts: skills.skillDrafts,
    previewSkillHub: hub.previewSkillHub,
    approveSkillHub: hub.approveSkillHub,
    rejectSkillHub: hub.rejectSkillHub,
    uninstallSkillHub: hub.uninstallSkillHub,
    updateSkillHub: hub.updateSkillHub,
    undoSkillHub: hub.undoSkillHub,
    skillHubPending: hub.skillHubPending,
    skillHubInstalled: hub.skillHubInstalled,
    skillEdits: skills.skillEdits,

    setSkills(helper, chosen) {
      const known = mustHelper(helper);
      const names = [...new Set(chosen)];
      if (names.length > MAX_SKILLS) throw new HelperError(`A worker can have at most ${MAX_SKILLS} skills.`);
      const bad = names.find((n) => !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(n));
      if (bad !== undefined) throw new HelperError(`"${bad.slice(0, 40)}" is not a skill name.`);
      transaction(() => {
        clearSkills.run(known.id);
        for (const n of names) putSkill.run(known.id, n);
      });
      emit({ action: "skills", helper: known.id, count: names.length });
    },

    removeGrant(helper, path) {
      const known = mustHelper(helper);
      if (Number(dropGrant.run(known.id, path).changes) === 0) return false;
      emit({ action: "grant", helper: known.id, granted: false });
      return true;
    },

    setPlanFirst(helper, on) {
      const known = mustHelper(helper);
      putSetting.run(`planFirst:${known.id}`, String(on));
      emit({ action: "settings" });
    },

    setBrowser(helper, on) {
      const known = mustHelper(helper);
      putSetting.run(`browser:${known.id}`, String(on));
      emit({ action: "settings" });
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
      if (options.parentId !== undefined && !get(options.parentId)) throw new HelperError(`There is no task ${options.parentId}.`);
      // A new task cannot close a circle: everything it waits for already exists.
      const blockers = checkBlockers(options.blockedBy ?? []);
      let id = 0;
      transaction(() => (id = insertTask(known.id, task, blockers, { goal, parentId: options.parentId ?? null, goalId: null, planFirst: options.planFirst })));
      emit({ action: "job", helper: known.id, job: id, state: "queued" });
      return mustGet(id);
    },

    addNativeJob(helper, raw, links) {
      const known = availableHelper(helper);
      if (links.advisoryParentId !== undefined) {
        const task = cleanTask(raw);
        let id = 0;
        transaction(() => {
          const parent = mustGet(links.advisoryParentId!);
          if (parent.state !== "running" || !parent.chatId || parent.chatId !== links.chatId || parent.nativeScope || parent.parentId !== undefined) throw new HelperError("An advisory child requires an active root native task in this chat.");
          availableHelper(parent.helper);
          if (parent.helper === helper) throw new HelperError("An advisory child must be another worker.");
          const children = childrenOf.all(parent.id) as unknown as JobRow[];
          if (children.filter((c) => c.native_scope === "advisory").length >= 2) throw new HelperError("This parent already used its two advisory children.");
          if (children.some((c) => c.state === "running")) throw new HelperError("Wait for this parent's existing child to end.");
          id = insertTask(known.id, task, [], { goal: null, parentId: parent.id, goalId: null, planFirst: false });
          db.prepare("UPDATE jobs SET native_scope = 'advisory' WHERE id = ?").run(id);
          setNativeLinks.run(links.chatId, links.sdkTaskId ?? null, id);
          claim.run(id);
          log(id, "running");
        });
        emit({ action: "job", helper: known.id, job: id, state: "running" });
        return mustGet(id);
      }
      const reserved = retryInChat.get(links.chatId) as { id: number } | undefined;
      if (!reserved && /^task-retry-\d+$/.test(links.chatId)) throw new HelperError("That retry attempt no longer exists. Start a new task instead.");
      if (reserved) {
        const attempt = mustGet(reserved.id);
        if (attempt.helper !== helper) throw new HelperError("This retry is reserved for its original worker.");
        if (attempt.state !== "queued" || Number(claim.run(attempt.id).changes) !== 1) throw new HelperError("This retry attempt was already dispatched. Review its task instead of starting it again.");
        log(attempt.id, "running");
        emit({ action: "job", helper, job: attempt.id, state: "running" });
        return mustGet(attempt.id);
      }
      const trimmed = raw.trim();
      const task = cleanTask(trimmed);
      let id = 0;
      transaction(() => {
        id = insertTask(known.id, task, [], { goal: null, parentId: null, goalId: null, planFirst: false });
        setNativeLinks.run(links.chatId, links.sdkTaskId ?? null, id);
        claim.run(id); // running at once: Claude Code runs it, never the legacy runner
        log(id, "running");
      });
      emit({ action: "job", helper: known.id, job: id, state: "running" });
      return mustGet(id);
    },

    queueNativeRetry(id) {
      let attempt = 0, created = false;
      transaction(() => {
        const old = mustGet(id);
        if (old.nativeScope === "advisory") throw new HelperError("Advisory children cannot retry independently. Ask their parent for a new bounded review.");
        if (old.retriedAs !== undefined) {
          if (!get(old.retriedAs)) throw new HelperError(`Retry attempt #${old.retriedAs} was removed. Start a new task instead of replaying this retry request.`);
          attempt = old.retriedAs; return;
        }
        if (old.state !== "failed" && old.state !== "stopped") throw new HelperError("Only a failed or stopped task can be tried again.");
        availableHelper(old.helper);
        attempt = insertTask(old.helper, old.task, [], { goal: null, parentId: null, goalId: null, planFirst: false });
        linkRetry.run(id, `task-retry-${attempt}`, attempt);
        rememberRetry.run(attempt, id);
        log(id, "retried"); created = true;
      });
      if (created) emit({ action: "job", helper: mustGet(attempt).helper, job: attempt, state: "queued" });
      return { job: mustGet(attempt), created };
    },

    failQueuedRetry(id, reason) {
      const job = get(id);
      if (job?.retryOf !== undefined && job.state === "queued") transition(job, "failed", { error: reason });
    },

    recoverNativeJob(id) {
      const job = get(id);
      if (!job?.chatId || job.state !== "running") return;
      const ended = now().toISOString();
      let changed = false;
      transaction(() => {
        changed = Number(db.prepare("UPDATE jobs SET state = 'failed', recovery_needed = 1, error = ?, ended_at = ?, wake_pending = 0 WHERE id = ? AND state = 'running'").run(job.nativeScope === "advisory" ? "The advisory session ended before its report completed. Request a new bounded review from its parent; do not retry this child independently." : "The worker's session ended before its outcome was confirmed. Files may already have changed. Review this attempt before retrying.", ended, id).changes) === 1;
        if (changed) log(id, "interrupted");
      });
      if (changed) emit({ action: "job", helper: job.helper, job: id, state: "failed" });
    },

    linkNativeTask(id, sdkTaskId) {
      setNativeTask.run(sdkTaskId, id);
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

    usage: () => tokens.summary(),
    recordedUsage: (chatId, model) => tokens.recorded(chatId, model),

    labels: () => finder.inUse(),
    search: (query) => finder.search(query),


    retry(id) {
      if (mustGet(id).nativeScope === "advisory") throw new HelperError("Advisory children cannot retry independently. Ask their parent for a new bounded review.");
      if (options.retryNative) return options.retryNative(id);
      const job = mustGet(id);
      if (job.chatId) throw new HelperError("Native tasks need the runtime's explicit retry dispatcher.");
      if (job.state !== "failed" && job.state !== "stopped") throw new HelperError("Only a failed or stopped task can be tried again.");
      log(id, "retried");
      wake(job);
    },

    startFresh(id) {
      const job = mustGet(id);
      if (job.chatId) throw new HelperError("Native tasks start a new attempt through Retry; their original attempt is kept.");
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

    interrupt(id) {
      const job = mustGet(id);
      if (job.nativeScope === "advisory") throw new HelperError("Stop this advisory child instead; it cannot enter the legacy run queue.");
      if (Number(putInterrupted.run(id).changes) === 0) throw new HelperError(`A ${job.state} job cannot be interrupted.`);
      log(id, "interrupted");
      emit({ action: "job", helper: job.helper, job: id, state: "queued" });
    },

    thread(id) {
      if (!get(id)) return undefined;
      const report = this.report(id);
      const row = jobById.get(id) as unknown as JobRow;
      return {
        id,
        ...(row.plan && row.plan_summary ? { plan: { summary: row.plan_summary, steps: row.plan } } : {}),
        handOffs: (childrenOf.all(id) as { id: number }[]).map((c) => c.id),
        comments: (commentsOf.all(id) as { id: number; text: string; created_at: string; delivery: string | null }[]).map((c) => ({
          id: c.id,
          text: c.text,
          createdAt: new Date(c.created_at),
          ...(c.delivery === "live" || c.delivery === "after" ? { delivery: c.delivery } : {}),
        })),
        activity: (eventsOf.all(id) as { kind: Activity["kind"]; at: string }[]).map((e) => ({ kind: e.kind, at: new Date(e.at) })),
        ...(report ? { report } : {}),
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
      for (const child of childrenOf.all(id) as unknown as JobRow[]) if (child.native_scope === "advisory" && !isFinal(child.state as JobState)) transition(toJob(child), "stopped");
      return true;
    },

    remove(id) {
      const job = get(id);
      if (!job) return false;
      if (!isFinal(job.state)) transition(job, "stopped"); // so a runner listening for "stopped" ends it
      for (const child of childrenOf.all(id) as unknown as JobRow[]) if (child.native_scope === "advisory" && !isFinal(child.state as JobState)) transition(toJob(child), "stopped");
      transaction(() => {
        deleteReport.run(id);
        deleteJob.run(id);
        dropLinks.run(id, id);
        dropPlanLink.run(id);
        unlinkParent.run(id);
        deleteComments.run(id);
        deleteEvents.run(id);
        toolCalls.drop(id);
        checkpoints.drop(id);
      });
      emit({ action: "deleted", helper: job.helper, job: id });
      return true;
    },

    report: reportOf,

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
