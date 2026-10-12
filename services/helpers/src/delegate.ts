import { HAND_OFFS, HelperError, MAX_GOAL_TASKS, MAX_HAND_OFFS } from "./jobs.ts";
import { WEEKDAYS, describeSchedule, parseRoutine, type Schedule } from "./routines.ts";
import type { GoalPart, HelperStore, HelperView, Job, ManagerView } from "./store.ts";

// ADR-082/087, Task 3.5: Pal hands work to the team. The model proposes; code checks every part (the store refuses an
// unknown or unavailable worker, bad tasks and bad waits) before anything is created.

const TASK_INPUT = "1 to 6 tasks, each an object {worker, task, after}";

/** The tool's description and capability; the team itself is in the context (names can change while ATOM runs). */
const DESCRIPTION =
  "Hand work to ATOM's workers. It runs in the background while you keep talking. Use it for research or writing that " +
  "takes minutes; answer quick questions yourself. goal: a short name for the result, such as \"home networking guide\". " +
  `tasks: ${TASK_INPUT}. worker: a worker's name from "Your team" in the context, or the name of a manager that plans ` +
  "and reviews (it splits that part across its agents itself). task: exactly what to find or write " +
  "and what to deliver. after (optional): the positions (1 = the first task) of earlier tasks whose reports this one " +
  "needs; it starts when they are done. When it returns, tell the user in one short sentence who is on it. The result comes later.";

/** A worker by its current name or its id, ignoring case. */
function byName(workers: readonly HelperView[], name: string): HelperView | undefined {
  const key = name.trim().toLowerCase();
  return workers.find((w) => w.name.toLowerCase() === key || w.id === key);
}

/**
 * The model's tasks as goal parts, with words the model can act on for anything malformed. ADR-095: a part may go to a
 * "plan" Manager by its name (it splits the part); a "group" Manager's Agents are named directly; an Agent under a
 * "plan" Manager is reached through that Manager.
 */
export function readParts(tasks: unknown, workers: readonly HelperView[], managers: readonly ManagerView[] = []): GoalPart[] {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > MAX_GOAL_TASKS) throw new HelperError(`tasks must be ${TASK_INPUT}.`);
  return tasks.map((raw, i) => {
    const t = raw as Record<string, unknown>;
    if (!t || typeof t !== "object" || typeof t.worker !== "string" || typeof t.task !== "string") {
      throw new HelperError(`Task ${i + 1} needs a worker and a task, both text.`);
    }
    if (t.after !== undefined && !(Array.isArray(t.after) && t.after.every((n) => Number.isInteger(n)))) {
      throw new HelperError(`Task ${i + 1}: after must be a list of task positions.`);
    }
    const after = t.after ? { after: t.after as number[] } : {};
    const key = t.worker.trim().toLowerCase();
    const manager = managers.find((m) => m.name.toLowerCase() === key || m.id === key);
    if (manager) {
      if (manager.mode === "plan") return { helper: manager.id, task: t.task, ...after };
      const names = workers.filter((w) => w.manager === manager.id && w.available).map((w) => w.name);
      throw new HelperError(`${manager.name} assigns directly: give task ${i + 1} to one of its agents (${names.join(", ") || "none yet"}).`);
    }
    const worker = byName(workers, t.worker);
    if (!worker) throw new HelperError(`There is no worker called "${t.worker.slice(0, 40)}". The team: ${workers.map((w) => w.name).join(", ")}.`);
    const boss = managers.find((m) => m.id === worker.manager);
    if (boss?.mode === "plan") throw new HelperError(`${worker.name} works under ${boss.name}, which plans its own work: give task ${i + 1} to ${boss.name} instead.`);
    return { helper: worker.id, task: t.task, ...after };
  });
}

export interface DelegateToolOptions {
  store: HelperStore;
  /** For the log: ids and counts only. */
  onDelegated?(event: { goal: number; tasks: number }): void;
  /** The chat that makes the goal, read at each call (a goal keeps it as its `source`). */
  source?(): string | undefined;
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
      const goal = store.addGoal(String(input.goal ?? ""), readParts(input.tasks, workers, store.managers()), options.source?.());
      options.onDelegated?.({ goal: goal.id, tasks: goal.tasks.length });
      const nameOf = (helper: string) => store.soul(helper).name; // a worker's or a Manager's
      const who = goal.tasks.map((t) => {
        const after = t.blockedBy.map((b) => nameOf(goal.tasks.find((x) => x.id === b)!.helper));
        return `${nameOf(t.helper)} (task ${t.id}${after.length ? `, after ${[...new Set(after)].join(" and ")}` : ""})`;
      });
      return `The team has it: ${who.join("; ")}. Tell the user in one short sentence who is on it. ATOM will say when it is ready.`;
    },
  };
}

export interface ScheduleToolOptions {
  store: HelperStore;
  /** For the log: ids only. */
  onScheduled?(event: { routine: number; helper: string }): void;
}

/** Task 3.9: the `schedule` tool, for routines in words the deterministic "Sid, every morning at 8, …" does not catch. */
export function createScheduleTool(options: ScheduleToolOptions) {
  const { store } = options;
  return {
    spec: {
      name: "schedule",
      description:
        "Make a routine: a task a worker does again and again by itself, such as every morning or every few hours. " +
        "worker: a worker's name from \"Your team\". task: what to do each time. every: \"day\", \"week\" or \"hours\". " +
        "time: for a day or week, the local time as HH:MM in 24-hour form. weekday: for a week, the day's English name. " +
        "hours: for hours, how many (1 to 168). When it returns, tell the user in one short sentence what will happen when.",
      inputSchema: {
        type: "object" as const,
        properties: {
          worker: { type: "string", description: "A worker's name" },
          task: { type: "string", description: "What to do each time" },
          every: { type: "string", description: '"day", "week" or "hours"' },
          time: { type: "string", description: "HH:MM, 24-hour, local time (day or week)" },
          weekday: { type: "string", description: "monday … sunday (week)" },
          hours: { type: "number", description: "1 to 168 (hours)" },
        },
        required: ["worker", "task", "every"],
      },
    },
    capability: { title: "Routines", examples: ["Sid, every morning at 8, summarise networking news", "Every Monday, have Penny check mortgage rates"] },
    run(input: Record<string, unknown>): string {
      const workers = store.list();
      const worker = byName(workers, String(input.worker ?? ""));
      if (!worker) throw new HelperError(`There is no worker called "${String(input.worker).slice(0, 40)}". The team: ${workers.map((w) => w.name).join(", ")}.`);
      const routine = store.addRoutine(worker.id, String(input.task ?? ""), scheduleFrom(input));
      options.onScheduled?.({ routine: routine.id, helper: worker.id });
      return `Routine made: ${worker.name}, ${describeSchedule(routine.schedule).toLowerCase()}. Keshab can remove it in the ATOM window.`;
    },
  };
}

export interface TeamTaskToolOptions {
  store: HelperStore;
  /** For the log: the team task id only. */
  onPosted?(event: { teamTask: number }): void;
}

/**
 * ADR-094: the `post_to_team` tool, for work no single worker fits: it waits on the Board until a worker (of the role,
 * if given) wakes up and takes it. The store checks the task and the role.
 */
export function createTeamTaskTool(options: TeamTaskToolOptions) {
  const { store } = options;
  return {
    spec: {
      name: "post_to_team",
      description:
        "Post a task to the team instead of one worker, when no single worker fits or whoever is free may do it. It waits " +
        "until a worker whose wake-ups are on wakes and takes it. task: exactly what to do and deliver. role (optional): one " +
        'of the roles in "Your team" (such as researcher); leave it out for anyone. Prefer delegate when one worker clearly fits.',
      inputSchema: {
        type: "object" as const,
        properties: {
          task: { type: "string", description: "What to do and deliver" },
          role: { type: "string", description: "A role from the team, or leave out for anyone" },
        },
        required: ["task"],
      },
    },
    capability: { title: "Post to the team", examples: ["Post a task to the team: compare three note-taking apps"] },
    run(input: Record<string, unknown>): string {
      const role = typeof input.role === "string" && input.role.trim() && input.role.trim().toLowerCase() !== "anyone" ? input.role : null;
      const posted = store.addTeamTask(String(input.task ?? ""), role);
      options.onPosted?.({ teamTask: posted.id });
      const wakers = store.list().filter((w) => w.wakeUp && !w.wakeUp.paused && (!posted.role || w.role === posted.role));
      const who = posted.role ? `a ${posted.role}` : "any worker";
      return (
        `Posted to the team as team task ${posted.id}, for ${who}. ` +
        (wakers.length ? `${wakers.map((w) => w.name).join(", ")} wake${wakers.length === 1 ? "s" : ""} up by themselves and may take it. ` : "No worker that may take it wakes up by itself yet: Keshab can turn wake-ups on on a worker's page in the ATOM window. ") +
        "Tell the user in one short sentence."
      );
    },
  };
}

/** The tool's words as a schedule; throws HelperError with what is wrong. */
function scheduleFrom(input: Record<string, unknown>): Schedule {
  const minute = () => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(input.time ?? ""));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new HelperError('time must be HH:MM in 24-hour form, such as "08:00".');
    return Number(m[1]) * 60 + Number(m[2]);
  };
  switch (input.every) {
    case "day":
      return { kind: "daily", minute: minute() };
    case "week": {
      const weekday = WEEKDAYS.indexOf(String(input.weekday ?? "").toLowerCase() as (typeof WEEKDAYS)[number]);
      if (weekday < 0) throw new HelperError("weekday must be a day's English name, such as monday.");
      return { kind: "weekly", weekday, minute: minute() };
    }
    case "hours":
      return { kind: "hours", every: Number(input.hours) };
    default:
      throw new HelperError('every must be "day", "week" or "hours".');
  }
}

/**
 * Task 3.10: a running task's `hand_off` tool, naming the workers its role may hand to (by their current names), or
 * undefined when there are none or the task is itself a sub-task. The store checks every call again.
 */
export function handOffTool(store: HelperStore, job: Job) {
  const team = store.list();
  const roles = HAND_OFFS[team.find((w) => w.id === job.helper)?.role ?? ""] ?? [];
  const workers = team.filter((w) => w.available && w.id !== job.helper && roles.includes(w.role));
  // ADR-095: a task a Manager handed out hands off as a top-level task does.
  const parent = job.parentId === undefined ? undefined : store.get(job.parentId);
  const fromManager = parent !== undefined && store.managers().some((m) => m.id === parent.helper);
  if ((job.parentId !== undefined && !fromManager) || !workers.length) return undefined;
  return {
    description:
      `Hand a sub-task to another of ATOM's workers when part of the job needs their skill: ${workers.map((w) => `${w.name} (${w.role})`).join(", ")}. ` +
      `worker: their name. task: exactly what they should find and deliver. At most ${MAX_HAND_OFFS}. After handing off, finish your ` +
      "report with what you have now; you will run again with their report to update it.",
    async run(input: { worker: string; task: string }): Promise<string> {
      const target = byName(workers, input.worker);
      if (!target) throw new HelperError(`You can hand work to ${workers.map((w) => w.name).join(", ")} only.`);
      const child = store.handOff(job.id, target.id, input.task);
      return `Task ${child.id} is with ${target.name}. Finish your report now with what you have; you will run again with their report.`;
    },
  };
}

/**
 * The team for the model's context, so it delegates by the names Keshab uses. ADR-095: with Managers, by Manager: a
 * "plan" Manager takes its part by its own name, a "group" Manager's Agents are named directly.
 */
export function teamContext(workers: readonly HelperView[], managers: readonly ManagerView[] = []): string {
  const later = workers.filter((w) => !w.available).map((w) => w.name);
  const tail = " Use the delegate tool to give them work that takes minutes." + (later.length ? ` Not ready yet: ${later.join(", ")}.` : "");
  const named = (list: readonly HelperView[]) => list.filter((w) => w.available).map((w) => `${w.name} (${w.role})`).join(", ");
  if (!managers.length) return `Your team: ${named(workers)}.${tail}`;
  const teams = managers.flatMap((m) => {
    const agents = named(workers.filter((w) => w.manager === m.id));
    if (!agents) return [];
    return [m.mode === "plan" ? `${m.name} (a manager that plans and reviews: give it its whole part by the name ${m.name}; its agents: ${agents})` : `${m.name} (give tasks to its agents directly: ${agents})`];
  });
  const loose = named(workers.filter((w) => !w.manager));
  return `Your team, by manager: ${teams.join("; ")}.${loose ? ` Not under a manager: ${loose}.` : ""}${tail}`;
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

/** Task 3.8: answers to a worker's waiting plan. */
const APPROVE = /^(?:yes|yeah|ok(?:ay)?|go ahead|approved?|approve it|start(?: it)?|do it|sounds good)(?:\s+please)?[.!]*$/i;
const REJECT = /^(?:no|nope|reject(?: it)?|don'?t|drop (?:it|that|the plan))(?:\s+thanks)?[.!]*$/i;

/** Task 3.14: "Sid, open it", "open that", "open the sources": the newest report, in Sid's app. */
const OPEN = /^(?:please\s+)?(?:open|show)(?:\s+(?:it|that|them|this|the sources|the report|your report|the tabs))?(?:\s+(?:up|please))?[.!]*$/i;

const STOP = /^(?:please\s+)?stop(?:\s+(?:it|that|now|working))?(?:\s+please)?[.!]*$/i;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * ADR-081: a sentence addressed to a worker by name settles in code, without the model: "Sid, research mesh Wi-Fi",
 * "Ask Sid to research mesh Wi-Fi", "Sid, stop". A name needs a comma or colon after it (or "ask/tell … to"), so
 * "Penny for your thoughts" stays a sentence for Pal.
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
 * Runs a worker command and returns ATOM's reply, or undefined when the sentence is not one. A new task becomes a goal
 * of one task, so ATOM says when it is done; a follow-up ("Sid, dig deeper on that") is a note on the worker's newest
 * task, which wakes it (Task 3.6). Refusals ("Kame is not ready yet.") are replies too.
 */
export function createWorkerShortcut(
  store: HelperStore,
  onHit?: (event: { helper: string; action: "task" | "again" | "stop" | "approve" | "reject" | "routine" | "open" }) => void,
  /** Task 3.14: opens a finished task's report in its worker's app; returns what happened, in words. */
  openReport?: (taskId: number) => Promise<string>,
) {
  return (text: string): string | Promise<string> | undefined => {
    const workers = store.list();
    const command = matchWorkerCommand(text, workers);
    if (!command) return undefined;
    // Task 3.9: "Sid, every morning at 8, summarise networking news" makes a routine; other "every …" wordings go to Pal.
    if ("task" in command && /^(?:every|each|daily|weekly)\b/i.test(command.task)) {
      const routine = parseRoutine(command.task);
      if (!routine) return undefined;
      onHit?.({ helper: command.helper, action: "routine" });
      try {
        const made = store.addRoutine(command.helper, routine.task, routine.schedule);
        return `${command.name} will do that ${describeSchedule(made.schedule).toLowerCase()}.`;
      } catch (error) {
        if (error instanceof HelperError) return error.message;
        throw error;
      }
    }
    const own = workers.find((w) => w.id === command.helper)!.jobs;
    const latest = own[0];
    if (openReport && "task" in command && OPEN.test(command.task)) {
      onHit?.({ helper: command.helper, action: "open" });
      const done = own.find((j) => j.state === "done");
      if (!done) return `${command.name} has no finished report yet.`;
      return openReport(done.id).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    }
    const planned = own.find((j) => j.state === "queued" && j.planStatus === "awaiting");
    if (planned && "task" in command && (APPROVE.test(command.task) || REJECT.test(command.task))) {
      const approve = APPROVE.test(command.task);
      onHit?.({ helper: command.helper, action: approve ? "approve" : "reject" });
      if (approve) store.approvePlan(planned.id);
      else store.rejectPlan(planned.id);
      return approve ? `${command.name} is starting.` : `${command.name} dropped that plan.`;
    }
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
      // ADR-095: a worker may run several tasks at once; a new one waits only while every run slot is taken.
      const full = workers.flatMap((w) => w.jobs).filter((j) => j.state === "running").length >= store.maxRunning();
      store.addGoal(command.task, [{ helper: command.helper, task: command.task }]);
      return full ? `${command.name} will start on it when another task ends.` : `${command.name} is on it.`;
    } catch (error) {
      if (error instanceof HelperError) return error.message;
      throw error;
    }
  };
}
