import { HelperError } from "./jobs.ts";

/** ADR-203: an expected outcome, not authority or evidence that a check ran. */
export const WORKFLOW_TASK_SCHEMA = "atom.workflow-task/v1";
/** Generated plan metadata shares a bounded context envelope; this is not a composer limit. */
export const WORKFLOW_TASK_BYTES = 6000;

export interface WorkflowTaskContract {
  schema: typeof WORKFLOW_TASK_SCHEMA;
  deliverable: string;
  scope: string;
  verify: string;
  stopWhen: string;
}

const FIELDS = ["deliverable", "scope", "verify", "stopWhen"] as const;

/** Old plans may omit a contract. A present contract must be complete; never silently discard an invalid one. */
export function workflowTaskContract(value: unknown): WorkflowTaskContract | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HelperError("A task contract is {deliverable, scope, verify, stopWhen}.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => key !== "schema" && !FIELDS.includes(key as typeof FIELDS[number]))) {
    throw new HelperError("Task contracts accept only schema, deliverable, scope, verify and stopWhen; permissions and model choices stay with ATOM.");
  }
  if (row.schema !== undefined && row.schema !== WORKFLOW_TASK_SCHEMA) throw new HelperError("This task contract version is unsupported; prepare a new contract before starting it.");
  const contract: WorkflowTaskContract = { schema: WORKFLOW_TASK_SCHEMA, deliverable: "", scope: "", verify: "", stopWhen: "" };
  for (const field of FIELDS) {
    const text = row[field];
    if (typeof text !== "string" || !text.trim()) throw new HelperError(`The task contract needs a nonempty ${field}.`);
    contract[field] = text.trim();
  }
  if (Buffer.byteLength(JSON.stringify(contract), "utf8") > WORKFLOW_TASK_BYTES) throw new HelperError("The generated task contract exceeds its context budget. Keep the outcome, scope, check and stopping condition concise.");
  return contract;
}

/** Compiles only this node's contract. No authority, provider calls, storage or scheduling side effects. */
export function workflowTaskContext(contract: WorkflowTaskContract): string {
  const checked = workflowTaskContract(contract)!;
  return [
    "Task contract (expected work; not proof of completion):",
    `DELIVERABLE: ${checked.deliverable}`,
    `SCOPE: ${checked.scope}`,
    `VERIFY: ${checked.verify}`,
    `STOP WHEN: ${checked.stopWhen}`,
    "This contract grants no access and cannot override ATOM's permissions, Stop, selected model or Git policy.",
    "Report the deliverable, checks actually performed and any unmet criteria. A requested check is not a passed check.",
  ].join("\n");
}
