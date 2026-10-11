import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isOver } from "./budgets.ts";
import { homedir } from "node:os";
import { MAX_GRANTS, checkGrant } from "./grants.ts";
import { KITS, MAX_AGENTS, agentId, cleanRole, loadAgents, retireAgent, writeAgent, type Kit } from "./agents.ts";

/** Task 3.12: most skills a worker may have. */
export const MAX_SKILLS = 10;
import { DEFAULT_PLAN_LIMIT, DEFAULT_TEAM_CAP, DEFAULT_WORKER_CAP, MAX_CAP, PLAN_LIMIT_RANGE, startOfDay, type Budgets } from "./budgets.ts";
import { isDue, routineTable } from "./routines.ts";
import { SOUL_FIELDS, proposalTable } from "./feedback.ts";
import { mcpTable } from "./mcp.ts";
import { usageTable } from "./usage.ts";
import { createSchema, sameSoul, toJobRow, toSoul, webSources, type JobRow, type ReportRow, type SoulRow } from "./store-schema.ts";
import {
  BUILT_IN_KITS,
  HAND_OFFS,
  HELPERS,
  HelperError,
  MAX_AUTO_RETRIES,
  MAX_HAND_OFFS,
  MAX_LEVELS,
  isRetryable,
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

export type * from "./store-types.ts";
import type { Activity, GoalReport, HelperChange, HelperStore, HelperStoreOptions, Job, Report, Source } from "./store-types.ts";

export { webSources } from "./store-schema.ts";

export function openHelperStore(options: HelperStoreOptions): HelperStore {
  const { path, now = () => new Date(), home = homedir(), agentsDir } = options;
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

  /** One worker of the team: built in (ADR-082) or an agent from `agentsDir` (ADR-088). */
  interface Member {
    id: HelperId;
    available: boolean;
    role: string;
    kit: Kit;
    custom: boolean;
  }
  const builtIns: Member[] = HELPERS.map((h) => ({ id: h.id, available: h.available as boolean, role: h.role, kit: BUILT_IN_KITS[h.role] ?? "think", custom: false }));
  let rosterProblems: string[] = [];

  /**
   * The team: the built-in workers, then every agent folder with a valid soul.md. An agent's file is its current
   * soul: when it differs from the last version kept here, it becomes a new version (so edits in an editor are kept).
   */
  function roster(): Member[] {
    if (!agentsDir) return builtIns;
    const { agents, problems } = loadAgents(agentsDir);
    rosterProblems = [...problems];
    const members = [...builtIns];
    for (const agent of agents) {
      if (members.some((m) => m.id === agent.id)) continue;
      let soul: Soul;
      let role: string;
      try {
        role = cleanRole(agent.role || "assistant");
        soul = cleanSoul(agent.soul, members.map((m) => current(m.id).name));
      } catch (error) {
        rosterProblems.push(`${agent.id}/soul.md: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      const last = latestSoul.get(agent.id) as unknown as SoulRow | undefined;
      if (!last) putSoul(agent.id, 1, soul);
      else if (!sameSoul(toSoul(last), soul)) {
        putSoul(agent.id, last.version + 1, soul);
        emit({ action: "soul", helper: agent.id, version: last.version + 1 });
      }
      members.push({ id: agent.id, available: true, role, kit: agent.kit, custom: true });
    }
    return members;
  }

  /** Keeps a custom agent's soul.md in step after a save, restore or accepted proposal. */
  function writeBack(member: Member) {
    if (!member.custom || !agentsDir) return;
    writeAgent(agentsDir, { id: member.id, role: member.role, kit: member.kit, soul: toSoul(current(member.id)) });
  }
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
  const bumpRetries = db.prepare("UPDATE jobs SET auto_retries = COALESCE(auto_retries, 0) + 1 WHERE id = ?");
  const putPlan = db.prepare(
    "UPDATE jobs SET state = 'queued', step = NULL, wake_pending = 0, plan = ?, plan_summary = ?, plan_status = 'awaiting' WHERE id = ? AND state = 'running'",
  );
  const setPlanStatus = db.prepare("UPDATE jobs SET plan_status = ? WHERE id = ? AND plan_status = 'awaiting'");
  const reopenGoal = db.prepare("UPDATE goals SET ended_at = NULL WHERE id = ?");
  const childrenOf = db.prepare("SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.parent_id = ? ORDER BY j.id");
  const dropBlocker = db.prepare("DELETE FROM job_blockers WHERE job_id = ? AND blocker_id = ?");
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

  const routines = routineTable(db);
  const proposals = proposalTable(db);
  const mcp = mcpTable(db);
  const tokens = usageTable(db, now);
  const putRating = db.prepare("UPDATE jobs SET rating = ?, rating_comment = ? WHERE id = ?");
  const reviewOf = db.prepare("SELECT id FROM jobs WHERE reviews = ? LIMIT 1");
  const insertReview = db.prepare("INSERT INTO jobs (helper, task, state, created_at, reviews) VALUES ('tinker', ?, 'queued', ?, ?)");
  const grantsOf = db.prepare("SELECT path FROM grants WHERE helper = ? ORDER BY rowid");
  const skillsOf = db.prepare("SELECT skill FROM helper_skills WHERE helper = ? ORDER BY skill");
  const clearSkills = db.prepare("DELETE FROM helper_skills WHERE helper = ?");
  const putSkill = db.prepare("INSERT OR IGNORE INTO helper_skills (helper, skill) VALUES (?, ?)");
  const putGrant = db.prepare("INSERT OR IGNORE INTO grants (helper, path) VALUES (?, ?)");
  const dropGrant = db.prepare("DELETE FROM grants WHERE helper = ? AND path = ?");
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
    // Task 3.13: Tinker takes no tasks of its own: it reviews the tasks Keshab rates as not good.
    if (known.role === "improver") throw new HelperError(`${current(known.id).name} only reviews tasks you rate as not good.`);
    if (!(known.available as boolean)) throw new HelperError(`${current(known.id).name} is not ready yet.`);
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
    if (pending) return wake(get(job.id)!);
    // ADR-090: a failure a second try may fix is retried once by itself, before anything waiting for it fails.
    if (to === "failed" && isRetryable(fields.error) && (get(job.id)?.autoRetries ?? 0) < MAX_AUTO_RETRIES) {
      bumpRetries.run(job.id);
      log(job.id, "retried");
      return wake(get(job.id)!);
    }
    if (to !== "failed" && to !== "stopped") return;
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
      return roster().map((h) => ({
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
        budget: budgets.workers[h.id],
        planFirst: planFirstOf(h.id),
        routines: routines.list().filter((r) => r.helper === h.id),
        grants: (grantsOf.all(h.id) as { path: string }[]).map((g) => g.path),
        skills: (skillsOf.all(h.id) as { skill: string }[]).map((s) => s.skill),
        proposals: proposals.list(h.id),
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
      const others = roster().filter((h) => h.id !== known.id).map((h) => current(h.id).name);
      const soul = cleanSoul(input, others);
      if (!sameSoul(soul, toSoul(current(known.id)))) newSoulVersion(known.id, soul);
      writeBack(known);
    },

    restoreSoul(helper, version) {
      const known = mustHelper(helper);
      const row = soulRow.get(known.id, version) as SoulRow | undefined;
      if (!row) throw new HelperError(`${current(known.id).name} has no version ${version}.`);
      if (row.version === current(known.id).version) return;
      // The old name may have been taken by another worker since.
      const others = roster().filter((h) => h.id !== known.id).map((h) => current(h.id).name);
      newSoulVersion(known.id, cleanSoul(toSoul(row), others));
      writeBack(known);
    },

    budgets() {
      const since = startOfDay(now()).toISOString();
      const spent = new Map((spentSince.all(since) as { helper: string; total: number }[]).map((r) => [r.helper, r.total]));
      const cap = (key: string, fallback: number) => {
        const value = (settingOf.get(key) as { value: string } | undefined)?.value;
        return value === undefined ? fallback : value === "none" ? null : Number(value);
      };
      const workers = Object.fromEntries(roster().map((h) => [h.id, { cap: cap(`budget:${h.id}`, DEFAULT_WORKER_CAP), spent: spent.get(h.id) ?? 0 }])) as Budgets["workers"];
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

    addGrant(helper, path) {
      const known = mustHelper(helper);
      if (known.kit !== "folders") throw new HelperError(`${current(known.id).name} does not work in folders.`);
      const real = checkGrant(path, home);
      if ((grantsOf.all(known.id) as unknown[]).length >= MAX_GRANTS) throw new HelperError(`A worker can have at most ${MAX_GRANTS} folders.`);
      putGrant.run(known.id, real);
      emit({ action: "grant", helper: known.id, granted: true });
    },

    createAgent(input) {
      if (!agentsDir) throw new HelperError("New agents need ZENO's agents folder.");
      const team = roster();
      if (team.filter((m) => m.custom).length >= MAX_AGENTS) throw new HelperError(`There are already ${MAX_AGENTS} agents.`);
      const role = cleanRole(input.role);
      if (!KITS.includes(input.kit)) throw new HelperError("Choose what the agent may use: research, folders or think.");
      const soul = cleanSoul({ name: input.name, personality: input.personality, howItWorks: input.howItWorks ?? "", rules: input.rules ?? "", lessons: "" }, team.map((m) => current(m.id).name));
      const id = agentId(soul.name, [...team.map((m) => m.id), ...loadAgents(agentsDir).agents.map((a) => a.id)]);
      writeAgent(agentsDir, { id, role, kit: input.kit, soul });
      roster(); // records version 1
      emit({ action: "agent", helper: id, added: true });
      return this.list().find((h) => h.id === id)!;
    },

    removeAgent(id) {
      const member = mustHelper(id);
      if (!member.custom || !agentsDir) throw new HelperError("Only an agent you added can be removed.");
      for (const job of this.list().find((h) => h.id === id)!.jobs) if (!isFinal(job.state)) this.stop(job.id);
      retireAgent(agentsDir, id, now());
      emit({ action: "agent", helper: id, added: false });
    },

    agentProblems() {
      roster();
      return rosterProblems;
    },

    rate(id, good, raw) {
      const job = mustGet(id);
      if (job.state !== "done" && job.state !== "failed") throw new HelperError("Only a finished task can be rated.");
      if (job.helper === "tinker") throw new HelperError("Tinker's reviews are answered by accepting or rejecting its proposal.");
      const comment = raw?.trim() || null;
      if (comment && comment.length > MAX_COMMENT_CHARS) throw new HelperError(`The comment is too long (limit ${MAX_COMMENT_CHARS}).`);
      putRating.run(good ? "good" : "bad", comment, id);
      emit({ action: "rating", helper: job.helper, job: id, good });
      // One review per task: Tinker's task waits in the queue like any other (budgets apply).
      if (good || reviewOf.get(id)) return;
      let reviewId = 0;
      transaction(() => {
        const at = now();
        reviewId = Number(insertReview.run(`Review task ${id} (${current(job.helper).name})`, at.toISOString(), id).lastInsertRowid);
        log(reviewId, "created", at);
      });
      emit({ action: "job", helper: "tinker", job: reviewId, state: "queued" });
    },

    reviewTarget(tinkerTaskId) {
      const reviewed = get(mustGet(tinkerTaskId).reviews ?? -1);
      if (!reviewed) return undefined;
      const row = jobById.get(reviewed.id) as unknown as JobRow & { rating_comment: string | null };
      const report = this.report(reviewed.id);
      return {
        worker: current(reviewed.helper).name,
        role: mustHelper(reviewed.helper).role,
        task: reviewed.task,
        soul: toSoul(current(reviewed.helper)),
        ...(row.rating_comment ? { comment: row.rating_comment } : {}),
        ...(reviewed.error ? { error: reviewed.error } : {}),
        ...(report ? { report: { title: report.title, summary: report.summary, body: report.body } } : {}),
      };
    },

    addProposal(tinkerTaskId, proposal) {
      const reviewed = get(mustGet(tinkerTaskId).reviews ?? -1);
      if (!reviewed) throw new HelperError("The reviewed task is gone.");
      if (!SOUL_FIELDS.includes(proposal.field)) throw new HelperError("A proposal changes personality, howItWorks, rules or lessons.");
      // The changed soul must still be a valid soul (limits, no empty personality): checked now, and again on accept.
      cleanSoul({ ...toSoul(current(reviewed.helper)), [proposal.field]: proposal.text }, []);
      const id = proposals.add(reviewed.helper, proposal.field, proposal.text.trim(), proposal.reason.trim(), reviewed.id, now());
      emit({ action: "proposal", helper: reviewed.helper, proposal: id, state: "pending" });
      return proposals.get(id)!;
    },

    acceptProposal(id) {
      const p = proposals.get(id);
      if (!p || p.state !== "pending") throw new HelperError("No proposal waits for an answer there.");
      const before = current(p.helper).version;
      this.saveSoul(p.helper, { ...toSoul(current(p.helper)), [p.field]: p.text });
      proposals.set(id, "accepted", before);
      emit({ action: "proposal", helper: p.helper, proposal: id, state: "accepted" });
    },

    rejectProposal(id) {
      const p = proposals.get(id);
      if (!p || p.state !== "pending") throw new HelperError("No proposal waits for an answer there.");
      proposals.set(id, "rejected");
      emit({ action: "proposal", helper: p.helper, proposal: id, state: "rejected" });
    },

    undoProposal(id) {
      const p = proposals.get(id);
      if (!p || p.state !== "accepted" || p.previousVersion === undefined) throw new HelperError("Only an accepted proposal can be undone.");
      this.restoreSoul(p.helper, p.previousVersion);
      proposals.set(id, "undone");
      emit({ action: "proposal", helper: p.helper, proposal: id, state: "undone" });
    },

    setSkills(helper, skills) {
      const known = mustHelper(helper);
      const names = [...new Set(skills)];
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

    handOff(parentId, helper, raw) {
      const parent = mustGet(parentId);
      if (parent.state !== "running") throw new HelperError("Only a running task can hand off work.");
      const target = availableHelper(helper);
      const from = current(parent.helper).name;
      const to = current(target.id).name;
      if (target.id === parent.helper) throw new HelperError("A worker cannot hand a task to itself.");
      if (!HAND_OFFS[mustHelper(parent.helper).role]?.includes(target.role)) throw new HelperError(`${from} cannot hand work to ${to} (${target.role}).`);
      let level = 1;
      for (let p: Job | undefined = parent; p?.parentId !== undefined; p = get(p.parentId)) level++;
      if (level + 1 > MAX_LEVELS) throw new HelperError("A sub-task cannot hand off work again. Do it yourself or say what is missing.");
      if ((childrenOf.all(parentId) as unknown[]).length >= MAX_HAND_OFFS) throw new HelperError(`A task can hand off at most ${MAX_HAND_OFFS} sub-tasks.`);
      const budgets = this.budgets();
      if (isOver(budgets.workers[target.id]!) || isOver(budgets.team)) throw new HelperError(`${to} has no budget left today. Carry on without the sub-task.`);
      const task = cleanTask(raw);
      let id = 0;
      transaction(() => {
        id = insertTask(target.id, task, [], { goal: parent.goal ?? null, parentId, goalId: parent.goalId ?? null, planFirst: false });
        insertBlocker.run(parentId, id);
        setPending.run(1, parentId); // runs again, once the sub-task is done
        log(parentId, "handed");
      });
      emit({ action: "job", helper: target.id, job: id, state: "queued" });
      emit({ action: "blockers", helper: parent.helper, job: parentId });
      return mustGet(id);
    },

    handOffs(parentId) {
      return (childrenOf.all(parentId) as unknown as JobRow[]).map((row) => {
        const report = row.state === "done" ? this.report(row.id) : undefined;
        return {
          worker: current(row.helper as HelperId).name,
          task: row.task,
          ...(report ? { report: { title: report.title, summary: report.summary, body: report.body } } : {}),
          ...(row.error ? { error: row.error } : {}),
        };
      });
    },

    addRoutine(helper, raw, schedule) {
      const known = availableHelper(helper);
      const id = routines.add(known.id, cleanTask(raw), schedule, now());
      emit({ action: "routine", helper: known.id, routine: id, outcome: "added" });
      return routines.get(id)!;
    },

    removeRoutine(id) {
      const routine = routines.get(id);
      if (!routine || !routines.remove(id)) return false;
      emit({ action: "routine", helper: routine.helper, routine: id, outcome: "removed" });
      return true;
    },

    runRoutines() {
      const at = now();
      const made: number[] = [];
      const skipped: number[] = [];
      for (const r of routines.list()) {
        if (!isDue(r, at)) continue;
        const last = r.lastTaskId === undefined ? undefined : get(r.lastTaskId);
        let taskId: number | null = null;
        if (!last || isFinal(last.state)) {
          try {
            taskId = this.addJob(r.helper, r.task).id;
          } catch {
            // the worker is not available any more: skipped this time
          }
        }
        routines.mark(r.id, at, taskId, taskId === null);
        (taskId === null ? skipped : made).push(r.id);
        emit({ action: "routine", helper: r.helper, routine: r.id, outcome: taskId === null ? "skipped" : "made" });
      }
      return { made, skipped };
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

    addUsage(entry) {
      tokens.add(entry);
      emit({ action: "usage" });
    },
    usage: () => tokens.summary(),

    mcpServers: () => mcp.list(),

    addMcpServer(input) {
      const id = mcp.add(input);
      emit({ action: "mcp", server: id, change: "added" });
      return mcp.get(id)!;
    },

    removeMcpServer(id) {
      if (!mcp.remove(id)) return false;
      emit({ action: "mcp", server: id, change: "removed" });
      return true;
    },

    setMcpServer(id, change) {
      const server = mcp.get(id);
      if (!server) throw new HelperError("There is no such server.");
      const team = roster().map((m) => m.id);
      const workers = change.workers ? [...new Set(change.workers)] : server.workers;
      const unknown = workers.find((w) => !team.includes(w));
      if (unknown !== undefined) throw new HelperError(`There is no worker called "${unknown.slice(0, 40)}".`);
      const enabled = change.enabled ?? server.enabled;
      if (enabled && !server.enabled && (!server.testedAt || server.problem)) throw new HelperError("Test the server first: it turns on once a test lists its tools.");
      mcp.flags(id, enabled, change.trusted ?? server.trusted, workers);
      emit({ action: "mcp", server: id, change: "set" });
    },

    recordMcpTest(id, outcome) {
      if (!mcp.get(id)) return;
      if ("tools" in outcome) mcp.tested(id, outcome.tools.slice(0, 200), now(), null);
      else mcp.tested(id, [], now(), outcome.problem.slice(0, 300));
      emit({ action: "mcp", server: id, change: "tested" });
    },

    retry(id) {
      const job = mustGet(id);
      if (job.state !== "failed" && job.state !== "stopped") throw new HelperError("Only a failed or stopped task can be tried again.");
      log(id, "retried");
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
        handOffs: (childrenOf.all(id) as { id: number }[]).map((c) => c.id),
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
