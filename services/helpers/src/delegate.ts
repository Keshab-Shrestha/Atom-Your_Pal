import { HelperError, MAX_GOAL_TASKS } from "./jobs.ts";
import type { GoalPart, HelperStore, HelperView } from "./store.ts";

// ADR-082/087, Task 3.5: Wisp hands work to the team. The model proposes; code checks every part (the store refuses an
// unknown or unavailable worker, bad tasks and bad waits) before anything is created.

const TASK_INPUT = "1 to 6 tasks, each an object {worker, task, after}";

/** The tool's description and capability; the team itself is in the context (names can change while ZENO runs). */
const DESCRIPTION =
  "Hand work to ZENO's workers. It runs in the background while you keep talking. Use it for research or writing that " +
  "takes minutes; answer quick questions yourself. goal: a short name for the result, such as \"home networking guide\". " +
  `tasks: ${TASK_INPUT}. worker: a worker's name from "Your team" in the context. task: exactly what to find or write ` +
  "and what to deliver. after (optional): the positions (1 = the first task) of earlier tasks whose reports this one " +
  "needs; it starts when they are done. When it returns, tell the user in one short sentence who is on it. The result comes later.";

/** A worker by its current name or its id, ignoring case. */
function byName(workers: readonly HelperView[], name: string): HelperView | undefined {
  const key = name.trim().toLowerCase();
  return workers.find((w) => w.name.toLowerCase() === key || w.id === key);
}

/** The model's tasks as goal parts, with words the model can act on for anything malformed. */
export function readParts(tasks: unknown, workers: readonly HelperView[]): GoalPart[] {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > MAX_GOAL_TASKS) throw new HelperError(`tasks must be ${TASK_INPUT}.`);
  return tasks.map((raw, i) => {
    const t = raw as Record<string, unknown>;
    if (!t || typeof t !== "object" || typeof t.worker !== "string" || typeof t.task !== "string") {
      throw new HelperError(`Task ${i + 1} needs a worker and a task, both text.`);
    }
    if (t.after !== undefined && !(Array.isArray(t.after) && t.after.every((n) => Number.isInteger(n)))) {
      throw new HelperError(`Task ${i + 1}: after must be a list of task positions.`);
    }
    const worker = byName(workers, t.worker);
    if (!worker) throw new HelperError(`There is no worker called "${t.worker.slice(0, 40)}". The team: ${workers.map((w) => w.name).join(", ")}.`);
    return { helper: worker.id, task: t.task, ...(t.after ? { after: t.after as number[] } : {}) };
  });
}

export interface DelegateToolOptions {
  store: HelperStore;
  /** For the log: ids and counts only. */
  onDelegated?(event: { goal: number; tasks: number }): void;
}

/** The `delegate` tool (a Tool for the tool engine, by shape). */
export function createDelegateTool(options: DelegateToolOptions) {
  const { store } = options;
  return {
    spec: {
      name: "delegate",
      description: DESCRIPTION,
      inputSchema: {
        type: "object" as const,
        properties: {
          goal: { type: "string", description: 'A short name for the result, e.g. "home networking guide"' },
          tasks: { type: "array", description: `${TASK_INPUT}; after lists earlier task positions it waits for` },
        },
        required: ["goal", "tasks"],
      },
    },
    capability: { title: "Hand work to the team", examples: ["Research home networking and write it up as a guide", "Sid, find the best mesh routers"] },
    run(input: Record<string, unknown>): string {
      const workers = store.list();
      const goal = store.addGoal(String(input.goal ?? ""), readParts(input.tasks, workers));
      options.onDelegated?.({ goal: goal.id, tasks: goal.tasks.length });
      const nameOf = (helper: string) => workers.find((w) => w.id === helper)!.name;
      const who = goal.tasks.map((t) => {
        const after = t.blockedBy.map((b) => nameOf(goal.tasks.find((x) => x.id === b)!.helper));
        return `${nameOf(t.helper)} (task ${t.id}${after.length ? `, after ${[...new Set(after)].join(" and ")}` : ""})`;
      });
      return `The team has it: ${who.join("; ")}. Tell the user in one short sentence who is on it. ZENO will say when it is ready.`;
    },
  };
}

/** The team for the model's context, so it delegates by the names Keshab uses. */
export function teamContext(workers: readonly HelperView[]): string {
  const ready = workers.filter((w) => w.available).map((w) => `${w.name} (${w.role})`);
  const later = workers.filter((w) => !w.available).map((w) => w.name);
  return (
    `Your team: ${ready.join(", ")}. Use the delegate tool to give them work that takes minutes.` +
    (later.length ? ` Not ready yet: ${later.join(", ")}.` : "")
  );
}

export type WorkerCommand = { helper: string; name: string; task: string } | { helper: string; name: string; stop: true };

/**
 * Task 3.6: words that ask a worker to go on with its last task rather than start a new one: "dig deeper on that",
 * "also cover IPv6", "keep going", or anything ending in "that", "it" or "this".
 */
const FOLLOW_UP =
  /^(?:(?:please|now|then)\s+)?(?:(?:dig|go|look)\s+(?:deeper|further|closer|again)|also\b|and\b|more\b|continue\b|keep going|follow up|expand|elaborate|redo|try again)|\b(?:that|it|this)[.!?]*$/i;

export function isFollowUp(task: string): boolean {
  return FOLLOW_UP.test(task.trim());
}

const STOP = /^(?:please\s+)?stop(?:\s+(?:it|that|now|working))?(?:\s+please)?[.!]*$/i;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * ADR-081: a sentence addressed to a worker by name settles in code, without the model: "Sid, research mesh Wi-Fi",
 * "Ask Sid to research mesh Wi-Fi", "Sid, stop". A name needs a comma or colon after it (or "ask/tell … to"), so
 * "Penny for your thoughts" stays a sentence for Wisp.
 */
export function matchWorkerCommand(text: string, workers: readonly HelperView[]): WorkerCommand | undefined {
  const s = text.trim().replace(/^(?:hey\s+)?zeno[,\s]+/i, "");
  for (const w of workers) {
    const name = escape(w.name);
    const m = new RegExp(`^(?:${name}\\s*[,:]|(?:please\\s+)?(?:ask|tell)\\s+${name}\\s+to)\\s+(.+)$`, "is").exec(s);
    const rest = m?.[1]?.trim();
    if (!rest) continue;
    return STOP.test(rest) ? { helper: w.id, name: w.name, stop: true } : { helper: w.id, name: w.name, task: rest };
  }
  return undefined;
}

/**
 * Runs a worker command and returns ZENO's reply, or undefined when the sentence is not one. A new task becomes a goal
 * of one task, so ZENO says when it is done; a follow-up ("Sid, dig deeper on that") is a note on the worker's newest
 * task, which wakes it (Task 3.6). Refusals ("Kame is not ready yet.") are replies too.
 */
export function createWorkerShortcut(store: HelperStore, onHit?: (event: { helper: string; action: "task" | "again" | "stop" }) => void) {
  return (text: string): string | undefined => {
    const workers = store.list();
    const command = matchWorkerCommand(text, workers);
    if (!command) return undefined;
    const latest = workers.find((w) => w.id === command.helper)!.jobs[0];
    const followUp = "task" in command && latest !== undefined && isFollowUp(command.task);
    onHit?.({ helper: command.helper, action: "task" in command ? (followUp ? "again" : "task") : "stop" });
    if (!("task" in command)) {
      const running = workers.find((w) => w.id === command.helper)!.jobs.filter((j) => j.state === "running");
      for (const job of running) store.stop(job.id);
      return running.length ? `${command.name} stopped.` : `${command.name} isn't working on anything.`;
    }
    try {
      if (followUp) {
        store.addComment(latest!.id, command.task);
        return latest!.state === "running" ? `${command.name} will look again when this run ends.` : `${command.name} will look again.`;
      }
      const busy = workers.find((w) => w.id === command.helper)!.jobs.some((j) => j.state === "running");
      store.addGoal(command.task, [{ helper: command.helper, task: command.task }]);
      return busy ? `${command.name} will start on it after the current task.` : `${command.name} is on it.`;
    } catch (error) {
      if (error instanceof HelperError) return error.message;
      throw error;
    }
  };
}
