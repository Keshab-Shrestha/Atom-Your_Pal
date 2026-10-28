import { HelperError, MAX_GOAL_TASKS } from "./jobs.ts";
import type { PortionResult } from "./work-plan.ts";

/** Host-created provenance and bounded report snapshots, never permission or reusable verification. */
export interface WorkflowRetryContext {
  schema: "atom.workflow-retry/v1";
  previousJob: number;
  sourceJob: number;
  sourcePlan: number;
  sourcePortion: number;
  prerequisites: PortionResult[];
}

export function workflowRetryContext(value: unknown): WorkflowRetryContext | undefined {
  if (value === undefined) return;
  const invalid = () => new HelperError("The saved workflow retry context is invalid. Review the original task instead of starting an uncontracted retry.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const row = value as Record<string, unknown>;
  if (row.schema !== "atom.workflow-retry/v1" || Object.keys(row).some((k) => !["schema", "previousJob", "sourceJob", "sourcePlan", "sourcePortion", "prerequisites"].includes(k))
    || [row.previousJob, row.sourceJob, row.sourcePlan, row.sourcePortion].some((n) => !Number.isSafeInteger(n) || Number(n) < 1)
    || Number(row.sourcePortion) > MAX_GOAL_TASKS || !Array.isArray(row.prerequisites) || row.prerequisites.length >= MAX_GOAL_TASKS) throw invalid();
  const seen = new Set<number>();
  const prerequisites = row.prerequisites.map((raw): PortionResult => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
    const p = raw as Record<string, unknown>;
    if (Object.keys(p).some((k) => !["n", "agent", "title", "summary", "body", "repairJob"].includes(k)) || !Number.isSafeInteger(p.n) || Number(p.n) < 1
      || Number(p.n) > MAX_GOAL_TASKS || seen.has(Number(p.n))
      || typeof p.agent !== "string" || !p.agent || p.agent.length > 80
      || typeof p.title !== "string" || p.title.length > 80 || typeof p.summary !== "string" || p.summary.length > 160
      || p.body !== undefined && (typeof p.body !== "string" || p.body.length > 1200)
      || p.repairJob !== undefined && (!Number.isSafeInteger(p.repairJob) || Number(p.repairJob) < 1)) throw invalid();
    seen.add(Number(p.n));
    return { n: Number(p.n), agent: p.agent, title: p.title, summary: p.summary, ...(typeof p.body === "string" ? { body: p.body } : {}), ...(p.repairJob !== undefined ? { repairJob: Number(p.repairJob) } : {}) };
  });
  const checked: WorkflowRetryContext = { schema: "atom.workflow-retry/v1", previousJob: Number(row.previousJob), sourceJob: Number(row.sourceJob),
    sourcePlan: Number(row.sourcePlan), sourcePortion: Number(row.sourcePortion), prerequisites };
  if (Buffer.byteLength(JSON.stringify(checked), "utf8") > 32_768) throw invalid();
  return checked;
}
