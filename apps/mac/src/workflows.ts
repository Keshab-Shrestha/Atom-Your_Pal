import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { checkSchedule, isDue, type Schedule } from "@ark/helpers";

/**
 * 2026-11-02 (Keshab's "Agent CRM workspace" reference, its Workflows page): a trigger, then steps, each an agent's task. A run is one
 * hidden ARK turn that makes a plan of the steps in order (plan_work), so each step starts when the one before ends and gets its
 * report. Triggers: by hand, on a schedule (the routines' schedule), or when a Board task fails or finishes. Kept in
 * data/workflows.json, owner-only. Pure, apart from the store.
 */
export interface WorkflowStep { helper: string; task: string }
export type WorkflowEvent = "task.failed" | "task.done";
export type WorkflowTrigger = { kind: "manual" } | { kind: "schedule"; schedule: Schedule } | { kind: "event"; event: WorkflowEvent };
export interface Workflow {
  id: string;
  name: string;
  /** Off: a draft. It still runs by hand ("Test run"); triggers start only a published (enabled) workflow. */
  enabled: boolean;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  createdAt: string;
  lastRunAt?: string;
}

export const MAX_WORKFLOWS = 20;
export const MAX_STEPS = 8;
export const MAX_NAME = 80;
export const MAX_TASK = 2000;
const EVENTS: readonly WorkflowEvent[] = ["task.failed", "task.done"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number, what: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${what} is empty.`);
  if (v.length > max) throw new Error(`${what} is longer than ${max} characters.`);
  return v.trim();
};

/** A workflow from the window, checked: a name, a known trigger, 1 to 8 steps, each with an agent that exists and a task. */
export function checkWorkflow(input: unknown, agents: readonly string[], now = new Date()): Workflow {
  if (!isObject(input)) throw new Error("A workflow is an object.");
  const trigger = input.trigger;
  if (!isObject(trigger)) throw new Error("A workflow needs a trigger.");
  let checked: WorkflowTrigger;
  if (trigger.kind === "manual") checked = { kind: "manual" };
  else if (trigger.kind === "schedule") checked = { kind: "schedule", schedule: checkSchedule(trigger.schedule as Schedule) };
  else if (trigger.kind === "event" && EVENTS.includes(trigger.event as WorkflowEvent)) checked = { kind: "event", event: trigger.event as WorkflowEvent };
  else throw new Error("The trigger is by hand, a schedule, or a Board task that fails or finishes.");
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > MAX_STEPS) throw new Error(`A workflow has 1 to ${MAX_STEPS} steps.`);
  const steps = input.steps.map((step, i) => {
    if (!isObject(step)) throw new Error(`Step ${i + 1} is not a step.`);
    if (typeof step.helper !== "string" || !agents.includes(step.helper)) throw new Error(`Step ${i + 1} needs one of your agents.`);
    return { helper: step.helper, task: text(step.task, MAX_TASK, `Step ${i + 1}'s task`) };
  });
  const id = typeof input.id === "string" && /^[a-z0-9-]{1,40}$/.test(input.id) ? input.id : randomUUID().slice(0, 8);
  return {
    id, name: text(input.name, MAX_NAME, "The name"), enabled: input.enabled === true, trigger: checked, steps,
    createdAt: typeof input.createdAt === "string" && !Number.isNaN(Date.parse(input.createdAt)) ? input.createdAt : now.toISOString(),
    ...(typeof input.lastRunAt === "string" && !Number.isNaN(Date.parse(input.lastRunAt)) ? { lastRunAt: input.lastRunAt } : {}),
  };
}

/** The published schedule workflows that came due since they last ran (missed times while ARK was closed count once). */
export function dueWorkflows(list: readonly Workflow[], now: Date): Workflow[] {
  return list.filter((w) => w.enabled && w.trigger.kind === "schedule" &&
    isDue({ schedule: w.trigger.schedule, createdAt: new Date(w.createdAt), ...(w.lastRunAt ? { lastAt: new Date(w.lastRunAt) } : {}) }, now));
}

/** The published workflows a Board task's end starts. */
export function eventWorkflows(list: readonly Workflow[], event: WorkflowEvent): Workflow[] {
  return list.filter((w) => w.enabled && w.trigger.kind === "event" && w.trigger.event === event);
}

/** The hidden turn's text: one plan, the steps in order, nothing else. `names` maps an agent id to its name. */
export function workflowPrompt(w: Workflow, names: (helper: string) => string | undefined, cause?: string): string {
  const steps = w.steps.map((s, i) => `${i + 1}. ${names(s.helper) ?? s.helper}: ${s.task}`);
  return [
    `Run the workflow "${w.name}"${cause ? ` (${cause})` : ""}. Call plan_work once with exactly these portions, in this order, each one after the one before it, `
      + "with the named agent and the task as written:",
    ...steps,
    "Then start each portion when it is ready. Do not add, merge or skip portions, and do not do the work yourself. When the last portion reports, say in one sentence how it went.",
  ].join("\n");
}

export interface WorkflowStore {
  list(): Workflow[];
  save(workflow: unknown): Workflow[];
  remove(id: string): Workflow[];
  markRun(id: string, at: Date): void;
}

/** data/workflows.json: `{ version: 1, workflows: [...] }`, written whole (a temp file, then rename), owner-only. */
export function createWorkflowStore(path: string, agents: () => readonly string[]): WorkflowStore {
  let cache: Workflow[] | undefined;
  const stepAgents = (w: unknown) => isObject(w) && Array.isArray(w.steps) ? w.steps.flatMap((s) => isObject(s) && typeof s.helper === "string" ? [s.helper] : []) : [];
  const read = (): Workflow[] => {
    if (cache) return cache;
    if (!existsSync(path)) return (cache = []);
    const raw = JSON.parse(readFileSync(path, "utf8")) as { workflows?: unknown[] };
    // A stored workflow whose agent was removed stays as it is; it fails its check only when it is saved again.
    cache = (raw.workflows ?? []).flatMap((w) => { try { return [checkWorkflow(w, stepAgents(w))]; } catch { return []; } });
    return cache;
  };
  const write = (list: Workflow[]) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, workflows: list }, null, 2), { mode: 0o600 });
    renameSync(temp, path);
    cache = list;
    return [...list];
  };
  return {
    list: () => [...read()],
    save(input) {
      const w = checkWorkflow(input, agents());
      const others = read().filter((x) => x.id !== w.id);
      if (others.length >= MAX_WORKFLOWS) throw new Error(`ARK keeps at most ${MAX_WORKFLOWS} workflows.`);
      const index = read().findIndex((x) => x.id === w.id);
      return write(index < 0 ? [...others, w] : read().map((x) => (x.id === w.id ? w : x)));
    },
    remove: (id) => write(read().filter((w) => w.id !== id)),
    markRun(id, at) { write(read().map((w) => (w.id === id ? { ...w, lastRunAt: at.toISOString() } : w))); },
  };
}
