import type { Tool } from "../engine.ts";

// ADR-061: timers. Held by the runtime (lost on quit); when one ends, onFire announces it.

export interface TimerInfo {
  id: number;
  label: string;
  /** When it ends. */
  endsAt: Date;
  seconds: number;
}

export interface TimerOptions {
  onFire: (timer: TimerInfo) => void;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  max?: number;
}

export interface Timers {
  tools: Tool[];
  list(): TimerInfo[];
  cancel(id: number): boolean;
  /** Clears every timer (quitting). */
  close(): void;
}

export const MAX_TIMER_SECONDS = 24 * 3600;

export function spokenDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const parts = [
    h ? `${h} hour${h === 1 ? "" : "s"}` : "",
    m ? `${m} minute${m === 1 ? "" : "s"}` : "",
    r && !h ? `${r} second${r === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" and ") : "less than a second";
}

export function createTimers(options: TimerOptions): Timers {
  const { onFire, now = Date.now, max = 10 } = options;
  const set = options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clear = options.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  const running = new Map<number, { info: TimerInfo; handle: unknown }>();
  let nextId = 1;

  const list = () => [...running.values()].map((t) => t.info).sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());
  const left = (t: TimerInfo) => spokenDuration(Math.max(0, (t.endsAt.getTime() - now()) / 1000));
  const describe = (t: TimerInfo) => `#${t.id} ${t.label ? `"${t.label}" ` : ""}(${left(t)} left)`;

  function cancel(id: number) {
    const t = running.get(id);
    if (!t) return false;
    clear(t.handle);
    running.delete(id);
    return true;
  }

  const tools: Tool[] = [
    {
      capability: { title: "Timers", examples: ["Set a timer for 10 minutes"] },
      spec: {
        name: "timer_set",
        description:
          "Starts a countdown timer. When it ends, ATOM says so out loud and shows it on screen. Use it for 'set a timer for 10 minutes' " +
          "or 'tell me in 20 minutes to check the oven'. Timers are lost if ATOM quits. For a reminder at a clock time or on another day, use reminder_add.",
        inputSchema: {
          type: "object",
          properties: {
            seconds: { type: "number", description: "Length in seconds (1 to 86400)." },
            label: { type: "string", description: "Optional short name, e.g. 'pasta' or 'check the oven'." },
          },
          required: ["seconds"],
        },
      },
      run(input) {
        const seconds = typeof input.seconds === "number" ? Math.round(input.seconds) : Number.NaN;
        if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_TIMER_SECONDS) throw new Error("seconds must be between 1 and 86400");
        if (running.size >= max) throw new Error(`there are already ${max} timers running; cancel one first`);
        const label = typeof input.label === "string" ? input.label.trim().slice(0, 60) : "";
        const info: TimerInfo = { id: nextId++, label, seconds, endsAt: new Date(now() + seconds * 1000) };
        const handle = set(() => {
          running.delete(info.id);
          onFire(info);
        }, seconds * 1000);
        running.set(info.id, { info, handle });
        return `Timer #${info.id}${label ? ` for ${label}` : ""} set for ${spokenDuration(seconds)}.`;
      },
    },
    {
      capability: { title: "Timers", examples: ["How long is left on my timer?"] },
      spec: {
        name: "timer_list",
        description: "Lists running timers with the time left on each.",
        inputSchema: { type: "object", properties: {} },
      },
      run() {
        const all = list();
        return all.length ? all.map(describe).join("\n") : "No timers running.";
      },
    },
    {
      capability: { title: "Timers", examples: ["Cancel the timer"] },
      spec: {
        name: "timer_cancel",
        description: "Cancels a running timer by its number (from timer_list or timer_set), or all of them with all: true.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "number", description: "The timer's number." }, all: { type: "boolean" } },
        },
      },
      run(input) {
        if (input.all === true) {
          const n = running.size;
          for (const id of [...running.keys()]) cancel(id);
          return n ? `Cancelled ${n} timer${n === 1 ? "" : "s"}.` : "No timers were running.";
        }
        const id = typeof input.id === "number" ? input.id : Number.NaN;
        if (!Number.isInteger(id)) throw new Error("give the timer's number, or all: true");
        return cancel(id) ? `Cancelled timer #${id}.` : `There is no running timer #${id}.`;
      },
    },
  ];

  return {
    tools,
    list,
    cancel,
    close() {
      for (const id of [...running.keys()]) cancel(id);
    },
  };
}
