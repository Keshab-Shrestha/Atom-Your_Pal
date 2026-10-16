// What the method groups of the helper store share (split out of store.ts, 2026-10-16). `openHelperStore` builds one of these after its own helpers
// exist, and each group (store-routines.ts, store-mcp.ts, ...) returns the part of `HelperStore` it owns. Only what a group needs is listed here.

import type { StatementSync } from "node:sqlite";
import type { Kit } from "./agents.ts";
import type { checkpointTable } from "./checkpoints.ts";
import type { proposalTable } from "./feedback.ts";
import type { mcpTable } from "./mcp.ts";
import type { planTable, StoredPlan } from "./plans.ts";
import type { routineTable } from "./routines.ts";
import type { HelperId } from "./jobs.ts";
import type { skillStore } from "./skill-drafts.ts";
import type { SoulRow } from "./store-schema.ts";
import type { Soul } from "./jobs.ts";
import type { searchTable } from "./search.ts";
import type { usageTable } from "./usage.ts";
import type { Activity, HelperChange, HelperStore, Job, PlanView } from "./store-types.ts";
import type { JobRow } from "./store-schema.ts";
import type { testCaseTable } from "./test-cases.ts";
import type { toolCallTable } from "./tool-calls.ts";

export const MAX_COMMENT_CHARS = 2000;

/** One worker of the team: built in (ADR-082) or an agent from the agents folder (ADR-088). */
export interface Member {
  id: HelperId;
  available: boolean;
  role: string;
  kit: Kit;
  custom: boolean;
  manager?: string;
}

export interface StoreContext {
  now: () => Date;
  /** Records the change in the audit log and tells every listener. */
  emit: (change: HelperChange) => void;
  routines: ReturnType<typeof routineTable>;
  mcp: ReturnType<typeof mcpTable>;
  /** The team, freshly read. */
  roster: () => Member[];
  /** The worker, or a HelperError for an unknown one, Tinker (it takes no tasks) or one that is not ready. */
  availableHelper: (helper: string) => Member;
  /** A task text, trimmed, or a HelperError for an empty or too long one. */
  cleanTask: (raw: string) => string;
  /** A task, or undefined. */
  get: (id: number) => Job | undefined;
  /** A task, or a HelperError when it is gone. */
  mustGet: (id: number) => Job;
  /** The worker, or a HelperError for an unknown one. */
  mustHelper: (helper: string) => Member;
  /** The worker's newest soul row. */
  current: (helper: HelperId) => SoulRow;
  /** A task's report, or undefined. */
  report: HelperStore["report"];
  tests: ReturnType<typeof testCaseTable>;
  skills: ReturnType<typeof skillStore>;
  proposals: ReturnType<typeof proposalTable>;
  /** The Tinker task that reviews a task (soul) or a skill: (job id, kind, skill) -> row with `id`. */
  tinkerOf: StatementSync;
  workPlans: ReturnType<typeof planTable>;
  planView: (stored: StoredPlan) => PlanView;
  toolCalls: ReturnType<typeof toolCallTable>;
  checkpoints: ReturnType<typeof checkpointTable>;
  /** The folders granted to a worker (rows with `path`). */
  grantsOf: StatementSync;
  /** Writes a new version of a worker's soul. */
  newSoulVersion: (helper: HelperId, soul: Soul) => void;
  /** Keeps an agent's soul.md in step after a change to its soul. */
  writeBack: (member: Member) => void;
  /** (helper, version) -> a soul row. */
  soulRow: StatementSync;
  /** (rating, comment, job id): stores a rating. */
  putRating: StatementSync;
  /** (job id) -> a job row with its rating comment. */
  jobById: StatementSync;
  /** Runs `work` in one transaction. */
  transaction: (work: () => void) => void;
  /** (job id, text, created at, delivery): stores a comment. */
  insertComment: StatementSync;
  /** Adds an entry to a task's activity. */
  log: (id: number, kind: Activity["kind"], at?: Date) => void;
  /** Starts or wakes a task that was waiting for a note. */
  wake: (job: Job) => unknown;
  finder: ReturnType<typeof searchTable>;
  tokens: ReturnType<typeof usageTable>;
  goalRow: StatementSync;
  goalTasks: StatementSync;
  toJob: (row: JobRow) => Job;
  /** Asks Tinker to review a task (kind null), make a skill or edit one; false when one was asked already. */
  askTinker: (jobId: number, task: string, kind: "skill" | "edit" | null, skill?: string | null) => boolean;
}
