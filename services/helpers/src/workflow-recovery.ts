import type { Job, PlanPortionView, PlanView } from "./store-types.ts";
import type { TaskAttemptState } from "./task-evidence.ts";

export const WORKFLOW_RECOVERY_SCHEMA = "atom.workflow-recovery/v1";
export type WorkflowRecoveryKind = "reported" | "repaired" | "working" | "waiting" | "retry-queued" | "blocked"
  | "failed" | "stopped" | "interrupted" | "unconfirmed" | "repair-unavailable";
/** Read-only explanation of existing records; never an execution instruction, grant or verified status. */
export interface WorkflowRecovery { schema: typeof WORKFLOW_RECOVERY_SCHEMA; kind: WorkflowRecoveryKind }

export function workflowRecovery(portion: Pick<PlanPortionView, "job" | "state" | "repair" | "resultJob">,
  job: Pick<Job, "state" | "retryOf" | "recoveryNeeded" | "title"> | undefined, attempt?: TaskAttemptState): WorkflowRecovery {
  const result = (kind: WorkflowRecoveryKind): WorkflowRecovery => ({ schema: WORKFLOW_RECOVERY_SCHEMA, kind });
  if (portion.repair?.state === "unavailable") return result("repair-unavailable");
  if ((portion.resultJob ?? portion.job) !== undefined && !job) return result("unconfirmed");
  if (job?.recoveryNeeded || attempt === "interrupted") return result("interrupted");
  if (job?.state === "done" && job.title === undefined) return result("unconfirmed");
  // Old tasks may have no attempt record. A contradictory present record must never be explained as completion.
  if (attempt && (job?.state === "done" && attempt !== "reported" || job?.state === "running" && attempt !== "running"
    || (job?.state === "failed" || job?.state === "stopped") && attempt === "reported")) return result("unconfirmed");
  if (portion.state === "blocked") return result(job?.state === "running" ? "unconfirmed" : "blocked");
  if (job?.state === "queued" && job.retryOf !== undefined) return result("retry-queued");
  if (portion.state === "done") return result(job?.state === "done" ? portion.repair?.state === "accepted" ? "repaired" : "reported" : "unconfirmed");
  if (portion.state === "running") return result(job?.state === "running" ? "working" : "unconfirmed");
  if (portion.state === "waiting") return result(!job || job.state === "queued" ? "waiting" : "unconfirmed");
  if (portion.state === "failed") return result(job?.state === "failed" ? "failed" : "unconfirmed");
  if (portion.state === "stopped") return result(job?.state === "stopped" ? "stopped" : "unconfirmed");
  return result("unconfirmed");
}

export function workflowRecoveryLabel(recovery: WorkflowRecovery): string {
  const labels: Record<WorkflowRecoveryKind, string> = { reported: "Reported done", repaired: "Retry report accepted", working: "Working",
    waiting: "Awaiting start", "retry-queued": "Retry queued", blocked: "Blocked", failed: "Failed", stopped: "Stopped",
    interrupted: "Interrupted; outcome unconfirmed", unconfirmed: "Outcome unconfirmed", "repair-unavailable": "Repair needs review" };
  return recovery.schema === WORKFLOW_RECOVERY_SCHEMA ? labels[recovery.kind] ?? "Outcome unconfirmed" : "Outcome unconfirmed";
}

/** Compact, deterministic model-facing explanation; task text and errors stay in their original records. */
export function workflowRecoveryText(view: Pick<PlanView, "portions">): string | undefined {
  const groups: [string, number[]][] = [
    ["Reports saved", []], ["Working", []], ["Awaiting start", []], ["Retries queued", []], ["Blocked", []],
    ["Interrupted; outcome unconfirmed", []], ["Stopped", []], ["Failed", []], ["Needs review", []],
  ];
  const group: Record<WorkflowRecoveryKind, number> = { reported: 0, repaired: 0, working: 1, waiting: 2, "retry-queued": 3,
    blocked: 4, interrupted: 5, stopped: 6, failed: 7, unconfirmed: 8, "repair-unavailable": 8 };
  let review = false, present = false;
  for (const p of view.portions) {
    if (!p.recovery) continue;
    present = true;
    const index = p.recovery.schema === WORKFLOW_RECOVERY_SCHEMA ? group[p.recovery.kind] ?? 8 : 8;
    groups[index]![1].push(p.n);
    if (index >= 4) review = true;
  }
  if (!present) return;
  const lines = groups.filter(([, portions]) => portions.length).map(([label, portions]) => `${label}: ${portions.map((n) => `P${n}`).join(", ")}.`);
  if (review) lines.push("Recovery summary only: unfinished actions may already have changed files. Review affected tasks and existing changes before choosing an explicit Retry. Resolve earlier portions before blocked work. Nothing is replayed by this summary; saved history and permission checks remain in place.");
  lines.push("A saved report describes reported work; it does not prove every requested check passed.");
  return lines.join("\n");
}
