import { HelperError } from "./jobs.ts";
import { WEEKDAYS, describeSchedule, type Schedule } from "./routines.ts";
import type { HelperStore, HelperView } from "./store.ts";

// Task 3.9: the `schedule` tool. The model proposes a routine; code checks it (the store refuses a bad schedule or an
// unknown worker) before anything is created.

/** A worker by its current name or its id, ignoring case. */
function byName(workers: readonly HelperView[], name: string): HelperView | undefined {
  const key = name.trim().toLowerCase();
  return workers.find((w) => w.name.toLowerCase() === key || w.id === key);
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
