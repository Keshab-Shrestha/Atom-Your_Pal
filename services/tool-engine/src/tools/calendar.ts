import { execFile } from "node:child_process";
import type { Tool } from "../engine.ts";

// ADR-060: Calendar and Reminders through zeno-calendar, a small EventKit helper inside ZENO.app, so macOS
// asks for permission once, for ZENO. Read-only for the calendar; Reminders may get a new reminder when the
// user asks for one (like "remember", no approval card: it is what was asked, and easy to undo in Reminders).

export interface CalendarRunner {
  (args: string[]): Promise<Record<string, unknown>>;
}

/** Runs the helper and parses its one JSON line. */
export function calendarRunner(helperPath: string, timeoutMs = 15_000): CalendarRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(helperPath, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (error, stdout) => {
        const line = String(stdout ?? "").trim().split("\n").at(-1) ?? "";
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") return resolve(parsed);
        } catch {
          // fall through
        }
        reject(new Error(error ? `the calendar helper failed: ${error.message.split("\n")[0]}` : "the calendar helper gave no answer"));
      });
    });
}

export interface CalendarToolOptions {
  run: CalendarRunner;
  now?: () => Date;
  /** The Mac's time zone for the model's reading of times (default: this process's). */
  timeZone?: string;
}

function local(iso: unknown, timeZone: string | undefined, allDay = false): string {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(allDay ? {} : { hour: "2-digit", minute: "2-digit" }),
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
}

async function call(run: CalendarRunner, args: string[]): Promise<Record<string, unknown>> {
  const result = await run(args);
  if (result.ok !== true) throw new Error(typeof result.error === "string" ? result.error : "the calendar helper refused");
  return result;
}

function parseWhen(value: unknown, field: string): Date {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required (ISO 8601, e.g. 2026-10-05T09:00:00+09:00)`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${field} "${value}" is not a date and time (use ISO 8601)`);
  return d;
}

export function createCalendarTools(options: CalendarToolOptions): Tool[] {
  const { run, now = () => new Date(), timeZone } = options;
  return [
    {
      spec: {
        name: "calendar_events",
        description:
          "Lists the user's calendar events between two times (all calendars on this Mac). Use it for questions about " +
          "their schedule: 'what's on today', 'am I free Friday afternoon', 'when is my next meeting'. Times are ISO 8601 " +
          "with the user's offset. At most 62 days.",
        inputSchema: {
          type: "object",
          properties: {
            from: { type: "string", description: "Start, ISO 8601 (e.g. 2026-10-05T00:00:00+09:00). Defaults to now." },
            to: { type: "string", description: "End, ISO 8601. Defaults to the end of tomorrow." },
          },
        },
      },
      async run(input) {
        const from = input.from === undefined ? now() : parseWhen(input.from, "from");
        let to: Date;
        if (input.to === undefined) {
          to = new Date(from);
          to.setDate(to.getDate() + 2);
          to.setHours(0, 0, 0, 0);
        } else to = parseWhen(input.to, "to");
        const result = await call(run, ["events", from.toISOString(), to.toISOString()]);
        const events = Array.isArray(result.events) ? (result.events as Record<string, unknown>[]) : [];
        if (events.length === 0) return `No events between ${local(from.toISOString(), timeZone)} and ${local(to.toISOString(), timeZone)}.`;
        return events
          .map((e) => {
            const allDay = e.allDay === true;
            const when = allDay ? `${local(e.start, timeZone, true)} (all day)` : `${local(e.start, timeZone)}–${local(e.end, timeZone).split(", ").at(-1)}`;
            const where = typeof e.location === "string" ? ` at ${e.location}` : "";
            return `- ${when}: ${String(e.title)}${where}`;
          })
          .join("\n");
      },
    },
    {
      spec: {
        name: "reminders_list",
        description: "Lists the user's open (not completed) reminders from Apple Reminders, soonest due first.",
        inputSchema: { type: "object", properties: {} },
      },
      async run() {
        const result = await call(run, ["reminders"]);
        const items = Array.isArray(result.reminders) ? (result.reminders as Record<string, unknown>[]) : [];
        if (items.length === 0) return "No open reminders.";
        return items
          .map((r) => `- ${String(r.title)}${r.due ? ` (due ${local(r.due, timeZone)})` : ""}${r.list ? ` [${String(r.list)}]` : ""}`)
          .join("\n");
      },
    },
    {
      spec: {
        name: "reminder_add",
        description:
          "Adds a reminder to the user's default Apple Reminders list, with an alert at the due time if one is given. " +
          "Use it only when the user asks to be reminded of something. Not for keeping facts (use remember for that).",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "What to be reminded of, short, e.g. 'Call Asha'." },
            due: { type: "string", description: "Optional due time, ISO 8601 with offset. Must be in the future." },
          },
          required: ["title"],
        },
      },
      async run(input) {
        const title = typeof input.title === "string" ? input.title.trim() : "";
        if (!title) throw new Error("title is required");
        const args = ["add-reminder", title.slice(0, 200)];
        if (input.due !== undefined) {
          const due = parseWhen(input.due, "due");
          if (due.getTime() < now().getTime() - 60_000) throw new Error("the due time is in the past");
          args.push(due.toISOString());
        }
        const result = await call(run, args);
        return `Added "${String(result.title)}" to ${String(result.list)}${result.due ? `, due ${local(result.due, timeZone)}` : ""}.`;
      },
    },
  ];
}
