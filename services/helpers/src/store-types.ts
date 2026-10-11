import type { Budget, Budgets } from "./budgets.ts";
import type { HandOffOutcome, HelperId, JobState, Soul, TaskContext } from "./jobs.ts";
import type { Routine, Schedule } from "./routines.ts";
import type { Proposal, ReviewTarget, SoulField } from "./feedback.ts";
import type { AgentProblem, Kit } from "./agents.ts";
import type { McpServer, McpServerInput } from "./mcp.ts";
import type { UsageEntry, UsageSummary } from "./usage.ts";

// The helper store's public shapes (split from store.ts): jobs as tasks, threads, goals, the store's operations.

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
  /** Task 3.13: Keshab's rating of a finished task; for a Tinker task, the task it reviews. */
  rating?: "good" | "bad";
  reviews?: number;
  /** ADR-090: how many times a failure was retried by itself (at most MAX_AUTO_RETRIES). */
  autoRetries: number;
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
  kind: "created" | "waits" | "commented" | "woken" | "fresh" | "planned" | "approved" | "rejected" | "handed" | "retried" | JobState;
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
  /** Task 3.10: the sub-tasks it handed off, oldest first. */
  handOffs: number[];
}

/** A goal's combined report (ADR-087, Task 3.5), written when all its tasks have ended. */
export interface GoalReport {
  title: string;
  summary: string;
  body: string;
  sources: Source[];
}

/** What Pal hands the team in one go (Task 3.5): a goal and its tasks. */
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
  /** ADR-088: what it may use (fixed in code), and whether Keshab added it (an agent folder). */
  kit: Kit;
  custom: boolean;
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
  /** Task 3.9: its routines, oldest first. */
  routines: Routine[];
  /** Task 3.11: the folders it may work in (real paths), in the order granted. */
  grants: string[];
  /** Task 3.12: the skills from ~/.claude/skills chosen for it, sorted. */
  skills: string[];
  /** Task 3.13: Tinker's proposals for its soul: every pending one and the newest others, newest first. */
  proposals: Proposal[];
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
  | { action: "routine"; helper: HelperId; routine: number; outcome: "added" | "removed" | "made" | "skipped" }
  | { action: "grant"; helper: HelperId; granted: boolean }
  | { action: "skills"; helper: HelperId; count: number }
  | { action: "agent"; helper: HelperId; added: boolean }
  | { action: "mcp"; server: number; change: "added" | "removed" | "set" | "tested" }
  | { action: "usage" }
  | { action: "rating"; helper: HelperId; job: number; good: boolean }
  | { action: "proposal"; helper: HelperId; proposal: number; state: "pending" | "accepted" | "rejected" | "undone" }
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
  /**
   * Task 3.10: a running task hands a sub-task to another worker. Checked here: the target is available and its role
   * may take work from this one, at most two levels and three sub-tasks a task, and neither budget is used up. The
   * task waits for the sub-task: when this run ends it runs again once the sub-task has. Throws HelperError otherwise.
   */
  handOff(parentId: number, helper: string, task: string): Job;
  /** Task 3.10: the sub-tasks a task handed off, with their outcomes. */
  handOffs(parentId: number): HandOffOutcome[];
  /**
   * Task 3.11: grants a folder to a worker whose role works in folders. Throws HelperError for another role, too many
   * grants, or a folder `checkGrant` refuses (the home folder itself, ~/Library, hidden folders, system folders).
   */
  addGrant(helper: string, path: string): void;
  removeGrant(helper: string, path: string): boolean;
  /**
   * ADR-088: adds an agent: a folder with its soul.md in the agents folder. Throws HelperError for a bad name, role,
   * kit or soul, or too many agents.
   */
  createAgent(input: { name: string; role: string; kit: Kit; personality: string; howItWorks?: string; rules?: string }): HelperView;
  /** Moves an agent Keshab added out of the team (its folder to agents-removed/), stopping its tasks. */
  removeAgent(id: string): void;
  /** Agent folders that could not be read, each with its folder name and why (ADR-093: logged and shown on the Board). */
  agentProblems(): AgentProblem[];
  /** ADR-090: MCP servers (secrets included: for the runtime only, never for the island or the log). */
  /** ADR-091: records the tokens one run used (a job or a chat answer). */
  addUsage(entry: UsageEntry): void;
  /** ADR-091: today and the last 7 days, by day, worker and model. */
  usage(): UsageSummary;
  mcpServers(): McpServer[];
  /** Saves a server, switched off. Throws HelperError for a bad name, command, address or line, or too many. */
  addMcpServer(input: McpServerInput): McpServer;
  removeMcpServer(id: number): boolean;
  /** Turns a server on or off, trusts it or not, and picks its workers. Throws HelperError for an unknown server or worker, or turning on one never tested. */
  setMcpServer(id: number, change: { enabled?: boolean; trusted?: boolean; workers?: string[] }): void;
  /** The outcome of a test: its tools, or why it failed. */
  recordMcpTest(id: number, outcome: { tools: string[] } | { problem: string }): void;
  /** ADR-090: runs a failed or stopped task again (resuming its session). Throws HelperError for any other state. */
  retry(id: number): void;
  /**
   * Task 3.13: rates a finished (done or failed) task. "Not good" asks Tinker to review it (a Tinker task, once per
   * task). Throws HelperError for an unknown or unfinished task or a long comment.
   */
  rate(id: number, good: boolean, comment?: string): void;
  /** What Tinker reads for one of its review tasks, or undefined when the reviewed task is gone. */
  reviewTarget(tinkerTaskId: number): ReviewTarget | undefined;
  /** Saves Tinker's proposal for the reviewed task's worker. Throws HelperError for a bad field or text. */
  addProposal(tinkerTaskId: number, proposal: { field: SoulField; text: string; reason: string }): Proposal;
  /** Accept makes a new soul version with the change; reject drops it; undo (after accept) restores the version before. */
  acceptProposal(id: number): void;
  rejectProposal(id: number): void;
  undoProposal(id: number): void;
  /** Task 3.12: the worker's skills, replacing what it had. Throws HelperError for a bad name or more than MAX_SKILLS. The caller checks they exist. */
  setSkills(helper: string, skills: readonly string[]): void;
  /** Task 3.9: a schedule that makes a task for a worker. Throws HelperError for an unknown or unavailable worker, a bad task or schedule, or too many. */
  addRoutine(helper: string, task: string, schedule: Schedule): Routine;
  removeRoutine(id: number): boolean;
  /**
   * Makes a task for each routine that came due since it last did (missed times count once). One whose last task is
   * still to do or running is skipped this time. Returns what was made and skipped, by routine id.
   */
  runRoutines(): { made: number[]; skipped: number[] };
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
  /** Task 3.11: the home folder grants are checked against (default the user's). */
  home?: string;
  /** ADR-088: the folder of agents Keshab added (each `<id>/soul.md`). Without it, only the built-in workers. */
  agentsDir?: string;
  now?: () => Date;
}
