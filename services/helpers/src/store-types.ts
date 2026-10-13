import type { Budget, Budgets } from "./budgets.ts";
import type { HandOffOutcome, HelperId, JobState, Soul, TaskContext } from "./jobs.ts";
import type { Routine, Schedule } from "./routines.ts";
import type { Proposal, ReviewTarget, SoulField } from "./feedback.ts";
import type { SkillDraft, SkillDraftState, SkillDraftTarget, SkillEdit, SkillEditState, SkillEditTarget } from "./skill-drafts.ts";
import type { HubFile, HubInstalled, HubPending } from "./skill-hub.ts";
import type { AgentProblem, Kit, ManagerMode } from "./agents.ts";
import type { McpServer, McpServerInput } from "./mcp.ts";
import type { UsageEntry, UsageSummary } from "./usage.ts";
import type { TeamTask, WakeEvery, WakeUp, Woken } from "./team.ts";
import type { SubAgent, SubAgentEvent, SubAgentState } from "./sub-agents.ts";
import type { ToolCall, ToolCallEvent } from "./tool-calls.ts";
import type { CheckpointItem, UndoResult } from "./checkpoints.ts";
import type { TaskSearchHit } from "./search.ts";
import type { TestBetter, TestCase, TestInputs, TestKind, TestResult, TestState } from "./test-cases.ts";

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
  /** ADR-098 item 3: Keshab interrupted its run; it waits ("to do", held) for his next message, which resumes it. */
  interrupted?: boolean;
  /** Task 3.8: its first run only plans; the plan waits for Keshab ("awaiting"), then goes to the next run ("approved"). */
  planFirst: boolean;
  planStatus?: "awaiting" | "approved";
  /** The plan in one sentence, once written. */
  planSummary?: string;
  /** Task 3.13: Keshab's rating of a finished task; for a Tinker task, the task it reviews. */
  rating?: "good" | "bad";
  reviews?: number;
  /** ADR-094: a Tinker task that drafts a skill from the task it is about ("skill") or edits one it used ("edit", `reviewSkill`). */
  reviewKind?: "skill" | "edit";
  reviewSkill?: string;
  /** ADR-090: how many times a failure was retried by itself (at most MAX_AUTO_RETRIES). */
  autoRetries: number;
  parentId?: number;
  /** The tasks it waits for, and those of them not done yet (it starts when this is empty). */
  blockedBy: number[];
  waitingFor: number[];
  /** How many notes Keshab added. */
  comments: number;
  /** ADR-095: the sub-agents its runs started (the newest), absent when none. */
  subAgents?: SubAgent[];
  /** ADR-098: its labels, sorted; absent when none. */
  labels?: string[];
}

export interface Comment {
  id: number;
  text: string;
  createdAt: Date;
  /**
   * ADR-098 item 3: a message Keshab sent to the running task: "live" reached the run at its next step; "after" could
   * not, so the task runs once more after this run. Absent for an ordinary note.
   */
  delivery?: "live" | "after";
}

/** One line of a task's activity: what happened and when (ids and states only, as in the logs). */
export interface Activity {
  /** ADR-095: "split" (a Manager handed its part to its Agents) and "revised" (it asked one of them for its one revision). */
  kind: "created" | "waits" | "commented" | "woken" | "fresh" | "planned" | "approved" | "rejected" | "handed" | "retried" | "split" | "revised" | "interrupted" | JobState;
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
  /** The chat that made the goal ("telegram", "api", a window chat id). Absent for goals from before this field. */
  source?: string;
  /** ADR-107: the project of the chat that made the goal. Absent for a plain chat. */
  projectId?: string;
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
  /** ADR-098: its runs get the browser (Playwright, ATOM's own profile). Default false. */
  browser: boolean;
  /** Task 3.9: its routines, oldest first. */
  routines: Routine[];
  /** ADR-094: its wake-ups; absent when off (the default). */
  wakeUp?: WakeUp;
  /** Task 3.11: the folders it may work in (real paths), in the order granted. */
  grants: string[];
  /** Task 3.12: the skills from ~/.claude/skills chosen for it, sorted. */
  skills: string[];
  /** Task 3.13: Tinker's proposals for its soul: every pending one and the newest others, newest first. */
  proposals: Proposal[];
  /** ADR-095: its Manager's id; absent when it has none (Tinker, or before the Managers were made). */
  manager?: string;
  /** Newest first, at most JOBS_PER_HELPER. */
  jobs: Job[];
}

/** ADR-095: a Manager: a domain with Agents under it. It has a soul and a budget, never a kit or tasks of its own. */
export interface ManagerView {
  id: string;
  name: string;
  mode: ManagerMode;
  soul: Soul;
  soulVersion: number;
  /** Its daily cap (default the team's) and today's spend on its plan and review runs. */
  budget: Budget;
  /** Its Agents' ids, in the team's order. */
  agents: HelperId[];
  /** Its own runs (plan mode: one per part ATOM handed it), newest first, at most JOBS_PER_HELPER. */
  jobs: Job[];
}

/** ADR-095: one of a Manager's tasks for its Agents, with what came of it. */
export interface ManagedTask extends HandOffOutcome {
  id: number;
  state: JobState;
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
  | { action: "routine"; helper: HelperId; routine: number; outcome: "added" | "changed" | "removed" | "made" | "skipped" | "paused" | "resumed" }
  | { action: "team"; task: number; change: "added" | "removed" | "taken"; helper?: HelperId; job?: number }
  | { action: "wakeUp"; helper: HelperId; change: "set" | "off" | "paused" | "resumed" | "woke"; job?: number }
  | { action: "grant"; helper: HelperId; granted: boolean }
  | { action: "skills"; helper: HelperId; count: number }
  | { action: "agent"; helper: HelperId; added: boolean }
  | { action: "manager"; manager: string; change: "added" | "removed" | "renamed" | "mode" | "moved"; helper?: HelperId }
  | { action: "mcp"; server: number; change: "added" | "removed" | "set" | "tested" }
  | { action: "usage" }
  | { action: "rating"; helper: HelperId; job: number; good: boolean }
  | { action: "proposal"; helper: HelperId; proposal: number; state: "pending" | "accepted" | "rejected" | "undone" }
  | { action: "skillDraft"; draft: number; job: number; skill: string; state: SkillDraftState }
  | { action: "skillEdit"; edit: number; job: number; skill: string; state: SkillEditState }
  | { action: "skillHub"; id?: number; skill?: string; state?: "pending" | "approved" | "rejected" | "uninstalled" | "updated" | "undone" }
  | { action: "model"; helper: HelperId; job: number }
  | { action: "job"; helper: HelperId; job: number; state: JobState; ms?: number }
  | { action: "step"; helper: HelperId; job: number }
  | { action: "comment"; helper: HelperId; job: number }
  | { action: "label"; helper: HelperId; job: number }
  | { action: "blockers"; helper: HelperId; job: number }
  | { action: "deleted"; helper: HelperId; job: number }
  | { action: "subAgent"; helper: HelperId; job: number; name: string; state: SubAgentState }
  | { action: "toolCall"; helper: HelperId; job: number }
  | { action: "checkpoint"; helper: HelperId; job: number; change: "kept" | "finished" | "undone"; count?: number }
  | { action: "goal"; goal: number; tasks: number; ended: boolean; source?: string }
  | { action: "testCase"; kind: TestKind; target: string; testCase: number; change: "saved" | "deleted" }
  | { action: "testRun"; kind: TestKind; item: number; case?: number; state: TestState | "started" };

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
  /** ADR-098 item 7: a task held only by the Claude plan's limit runs on Codex instead. Default false. */
  codexFallback(): boolean;
  setCodexFallback(on: boolean): void;
  /** Task 3.7: every cap and today's spend, and the plan limit. */
  budgets(): Budgets;
  /** Sets a worker's or the team's daily cap in dollars (null: no cap). Throws HelperError for an unknown worker or a bad amount. */
  setBudget(helper: string, cap: number | null): void;
  /** Sets the plan's five-hour use (percent) above which new runs wait. Throws HelperError outside 10 to 100. */
  setPlanLimit(percent: number): void;
  /** ADR-095: "Runs at once", the team-wide limit on runs at the same time (default 6). */
  maxRunning(): number;
  /** Sets "Runs at once". Throws HelperError outside 1 to 10. */
  setMaxRunning(count: number): void;
  /** Records what a run of a task cost (dollars of API-equivalent use; a Manager's run counts toward its budget). Nothing for an unknown task or a bad amount. */
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
  /** ADR-095: every Manager with its Agents, by folder name. */
  managers(): ManagerView[];
  /** Adds a Manager (its folder and soul.md; default mode "group"). Throws HelperError for a bad or taken name, or too many. */
  createManager(input: { name: string; mode?: ManagerMode }): ManagerView;
  /** Renames a Manager (a new soul version). Throws HelperError for an unknown Manager or a bad or taken name. */
  renameManager(id: string, name: string): void;
  setManagerMode(id: string, mode: ManagerMode): void;
  /** Moves a Manager's folder to agents-removed/. Refused while it has Agents. Its unfinished runs are stopped. */
  removeManager(id: string): void;
  /**
   * Puts an Agent under a Manager: an agent Keshab added gets `manager:` in its soul.md (recorded as a soul version), a
   * built-in worker a setting. Throws HelperError for an unknown Agent or Manager, or Tinker.
   */
  setManager(helper: string, manager: string): void;
  /**
   * ADR-095, for a "plan" Manager's first run: its Agents' tasks (1 to MAX_GOAL_TASKS, `helper` an Agent of that
   * Manager, `after` earlier positions). The Manager's task waits for them and runs again (its review) when they end.
   * Throws HelperError for a task that is not a running Manager's, one already split, or a bad part.
   */
  managerSplit(jobId: number, parts: readonly GoalPart[]): Job[];
  /**
   * The Manager's one revision: a note on one of its done tasks (which wakes it, as comment.add does); the Manager's task
   * runs again when that one ends. Throws HelperError when the revision is used, or for another task.
   */
  managerRevise(jobId: number, childId: number, note: string): void;
  /** A Manager's task's tasks with their outcomes, and whether its revision is used. */
  managerWork(jobId: number): { tasks: ManagedTask[]; revised: boolean };
  /** ADR-090: MCP servers (secrets included: for the runtime only, never for the island or the log). */
  /** ADR-091: records the tokens one run used (a job or a chat answer). */
  addUsage(entry: UsageEntry): { gapMs: number | null };
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
  /**
   * ADR-094: asks Tinker to draft a skill from a done task (at most one draft per task; rating a done task good asks
   * too). Throws HelperError for an unknown, unfinished or Tinker task, or one that has its draft already.
   */
  makeSkill(id: number): void;
  /** What Tinker reads for one of its draft tasks, or undefined when the task is gone. Throws HelperError for another kind of task. */
  skillDraftTarget(tinkerTaskId: number): SkillDraftTarget | undefined;
  /** What Tinker reads for one of its edit tasks, or undefined when the task is gone or the skill is not ATOM's any more. */
  skillEditTarget(tinkerTaskId: number): SkillEditTarget | undefined;
  /** Saves Tinker's draft for Keshab's OK. Throws HelperError for a bad name, description or steps, or a second draft. */
  addSkillDraft(tinkerTaskId: number, draft: { name: string; description: string; body: string }): SkillDraft;
  /**
   * Approve writes data/skills/<name>/SKILL.md (front matter and steps); a name already used by one of Keshab's skills
   * or ATOM's is refused. Reject only marks it. Both throw HelperError when no draft waits.
   */
  approveSkillDraft(id: number): void;
  rejectSkillDraft(id: number): void;
  /** Saves Tinker's edit (the whole new steps) for Keshab's OK. Throws HelperError unless the skill is one of ATOM's own. */
  addSkillEdit(tinkerTaskId: number, edit: { body: string; reason: string }): SkillEdit;
  /** Accept writes the new steps (keeping what was there for undo); reject marks it; undo (after accept) restores the old steps. */
  acceptSkillEdit(id: number): void;
  rejectSkillEdit(id: number): void;
  undoSkillEdit(id: number): void;
  /** Records that a run of a task used a skill (Skill tool calls). Bad names and unknown tasks are ignored. */
  recordSkillUse(jobId: number, skill: string): void;
  /** ADR-095: one sub-agent's start or end in a run of this task (an unknown task, or a bad name, is ignored). */
  recordSubAgent(jobId: number, event: SubAgentEvent): void;
  /** B3.1: one tool call's start or end in a run of this task (an unknown task, a bad state, an end without its start is ignored). */
  recordToolCall(jobId: number, event: ToolCallEvent): void;
  /** B3.1: the task's newest tool calls (at most 100), oldest first. */
  toolCalls(jobId: number): ToolCall[];
  /**
   * B3.4: before a run's first edit of `path` (a folder tool is about to change it): keeps the original, or notes the
   * file is new. `roots` are the run's folders. Never throws for a file it cannot keep (that is a "skipped" file).
   */
  checkpoint(jobId: number, roots: readonly string[], path: string): void;
  /** B3.4: at the run's end: notes how each kept file was left; a file the run did not change drops out. */
  finishCheckpoints(jobId: number): void;
  /** B3.4: the task's kept files (at most 100), oldest first. */
  checkpoints(jobId: number): CheckpointItem[];
  /**
   * B3.4: undoes the run's file edits: one file (`path`, relative) or all. A file changed since the run is a conflict
   * unless `force`; a file outside the agent's grants now is refused. Throws HelperError for an unknown task.
   */
  undoCheckpoints(jobId: number, options?: { path?: string; force?: boolean }): UndoResult[];
  /** B3.4: whether the task's runs called Bash (its edits are not tracked) and could have changed files in a folder. */
  bashRan(jobId: number): boolean;
  /** The skills a task's runs used, sorted. */
  skillsUsed(jobId: number): string[];
  /** Every pending draft and edit, and the newest few others, newest first. */
  skillDrafts(): SkillDraft[];
  skillEdits(): SkillEdit[];
  /**
   * B3.5, ADR-102: a skill fetched from the pinned hub repo, shown for Keshab's OK (nothing is written yet). Throws
   * HelperError for a bad name, path or sha, hidden characters, text over MAX_HUB_BODY, a fourth waiting skill or a repeat.
   */
  previewSkillHub(file: HubFile): HubPending;
  /** Approve writes data/skills/<name>/SKILL.md and records where it came from; a name that exists is refused. It gives the skill to no worker. */
  approveSkillHub(id: number): void;
  rejectSkillHub(id: number): void;
  /** Removes the folder, the record and the workers' choice of it; a folder changed by hand stays unless `force`. */
  uninstallSkillHub(name: string, force?: boolean): void;
  /** A newer text for an installed skill becomes a waiting update; undefined when it is the installed text. Writes nothing. */
  updateSkillHub(name: string, file: { sha: string; text: string }): HubPending | undefined;
  /** Restores the text before the last approved update, once. */
  undoSkillHub(name: string): void;
  skillHubPending(): HubPending[];
  skillHubInstalled(): HubInstalled[];
  /**
   * ADR-098 item 8: saves a done task as a test case for its agent's soul ("soul", target its agent id) or for a
   * ATOM-made skill its run used ("skill", target the skill's name). Throws HelperError for another task or target, a
   * task saved already for that target, or an 11th case (MAX_TEST_CASES).
   */
  saveTestCase(jobId: number, kind: TestKind, target: string): TestCase;
  deleteTestCase(id: number): void;
  /** Every test case, newest first. */
  testCases(): TestCase[];
  /**
   * What a test run of a pending soul proposal ("soul") or skill edit ("skill") needs: the newest TEST_CASES_RUN cases
   * and the system text with the old and with the new text. Throws HelperError when nothing waits there.
   */
  testInputs(kind: TestKind, id: number): TestInputs;
  /** A test run's start (each case "running") and each case's outcome. */
  startTestRun(kind: TestKind, id: number, cases: TestCase[]): void;
  finishTestCase(kind: TestKind, id: number, testCase: TestCase, outcome: { state: TestState; better?: TestBetter; reason?: string; oldAnswer?: string; newAnswer?: string }): void;
  testResults(kind: TestKind, id: number): TestResult[];
  /** The Tinker task that made a soul proposal or skill edit (its test runs count on that task's spend), if it still exists. */
  tinkerTaskOf(kind: TestKind, id: number): number | undefined;
  /** Task 3.12: the worker's skills, replacing what it had. Throws HelperError for a bad name or more than MAX_SKILLS. The caller checks they exist. */
  setSkills(helper: string, skills: readonly string[]): void;
  /** Task 3.9: a schedule that makes a task for a worker. Throws HelperError for an unknown or unavailable worker, a bad task or schedule, or too many. */
  addRoutine(helper: string, task: string, schedule: Schedule, startAt?: Date, notifyTelegram?: boolean, webhook?: boolean): Routine;
  /**
   * ADR-097: changes a routine's worker, task and schedule (`startAt`: an hourly one's next time). It counts from now: a
   * changed time does not come due at once. Throws HelperError as `addRoutine` does, and for an unknown routine.
   * ADR-098: `notifyTelegram` sends its result to Telegram, and `webhook` lets the local API start it; undefined keeps
   * the current choice.
   */
  updateRoutine(id: number, helper: string, task: string, schedule: Schedule, startAt?: Date, notifyTelegram?: boolean, webhook?: boolean): Routine;
  /**
   * ADR-098 item 5: makes the routine's task now (a webhook call). Its schedule does not change. Throws HelperError for an
   * unknown routine, an unavailable worker, or when its last task has not ended.
   */
  startRoutine(id: number): Job;
  removeRoutine(id: number): boolean;
  /** ADR-094: pauses or resumes a routine (a resumed one does not make up missed times). Throws HelperError for an unknown one. */
  pauseRoutine(id: number, paused: boolean): void;
  /** ADR-094: the team tasks waiting to be taken, oldest first. */
  teamTasks(): TeamTask[];
  /**
   * ADR-094: posts a task to the team, for any worker or only one role. Throws HelperError for a bad task, a role no
   * worker has, or too many waiting.
   */
  addTeamTask(task: string, role?: string | null): TeamTask;
  removeTeamTask(id: number): boolean;
  /** ADR-094: a worker's wake-ups on (how often) or off (null). Throws HelperError for an unknown worker or one that takes no tasks. */
  setWakeUp(helper: string, every: WakeEvery | null): void;
  /** Throws HelperError when the worker has no wake-ups. */
  pauseWakeUp(helper: string, paused: boolean): void;
  /**
   * ADR-094: wakes the workers whose time has come. One that wakes while a run slot is free (ADR-095), within its and the team's budget and below the
   * plan's limit (`planUsed`, percent, when known) takes the oldest team task its role may do, as its own task.
   */
  runWakeUps(planUsed?: number): Woken[];
  /**
   * Makes a task for each routine that came due since it last did (missed times count once). One whose last task is
   * still to do or running is skipped this time. Returns what was made and skipped, by routine id.
   */
  runRoutines(): { made: number[]; skipped: number[] };
  /** Task 3.8: whether a worker's new tasks plan first. Throws HelperError for an unknown worker. */
  setPlanFirst(helper: string, on: boolean): void;
  /** ADR-098: whether a worker's runs get the browser. Throws HelperError for an unknown worker. */
  setBrowser(helper: string, on: boolean): void;
  /**
   * ADR-098 item 3, for the runner: Keshab interrupted the run. The task goes back to "to do", held until his next
   * note (which resumes its session); when a note already waits, it runs again at once.
   */
  interrupt(id: number): void;
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
  addGoal(text: string, parts: readonly GoalPart[], source?: string, projectId?: string): Goal;
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
   * for an unknown task or an empty or long note. ADR-098 item 3: an interrupted task runs again with it. `delivery`
   * marks Keshab's message to a running task: "live" (the run took it, so nothing wakes) or "after" (one more run).
   */
  addComment(id: number, text: string, delivery?: "live" | "after"): void;
  /** ADR-098 item 3: the last `count` "live" messages the run may not have read become "after": one more run. */
  steerUnread(id: number, count: number): void;
  /** ADR-098: adds a label to a task (returns it cleaned). Throws HelperError for an unknown task, a bad label or a seventh. */
  addLabel(id: number, label: string): string;
  /** ADR-098: removes a task's label. Throws HelperError for an unknown task. */
  removeLabel(id: number, label: string): void;
  /** ADR-098: every label on some task, sorted. */
  labels(): string[];
  /** ADR-098: tasks (task text, labels, notes) and reports matching the words, best first, at most 20 of each. */
  search(query: string): { tasks: TaskSearchHit[]; reports: TaskSearchHit[] };
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
  /** ADR-094: ATOM's own skills folder (each `<name>/SKILL.md`). Without it, drafts cannot be approved. */
  skillsDir?: string;
  /** B3.4: where the copies of files a run changed are kept (`<dir>/<task>/<n>`). Without it, nothing is kept. */
  checkpointsDir?: string;
  now?: () => Date;
}
