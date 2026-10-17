import type { BriefSettings } from "@atom/memory";

/**
 * Daily brief (upgrades.md C3): the facts of the user's day, gathered by code. No model runs here. A source that fails or is
 * off leaves its part out, and the rest still make a brief. Remembered facts are never gathered (ADR-058).
 */

/** The most lines of one part. */
export const PART_LINES = 8;

export interface BriefSources {
  /** The calendar tool's text for today. */
  events?(): Promise<string>;
  /** The reminders tool's text. */
  reminders?(): Promise<string>;
  /** The weather tool's text. */
  weather?(): Promise<string>;
  /** Titles of tasks that ended since `sinceIso`. */
  tasks?(sinceIso: string): string[];
  /** What waits for the user: short phrases, no task text. */
  needsYou?(): string[];
  /** Timers that run now: "Tea, 4 minutes left". */
  timers?(): string[];
}

export type BriefPartKey = "events" | "reminders" | "weather" | "tasks" | "needsYou" | "timers";

export interface BriefPart {
  key: BriefPartKey;
  title: string;
  lines: string[];
}

export interface BriefData {
  parts: BriefPart[];
}

const bullets = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());

const cut = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The parts that have data, in the order a brief reads: weather, events, reminders, tasks, needs you, timers. */
export async function gatherBrief(
  sources: BriefSources,
  settings: Pick<BriefSettings, "events" | "reminders" | "weather" | "tasks" | "needsYou">,
  sinceIso: string,
  onSkip?: (key: BriefPartKey) => void,
): Promise<BriefData> {
  const parts: BriefPart[] = [];
  const add = async (key: BriefPartKey, title: string, on: boolean, read: (() => Promise<string[]> | string[]) | undefined) => {
    if (!on || !read) return;
    try {
      const lines = (await read()).map((l) => cut(l.replace(/\s+/g, " ").trim())).filter(Boolean).slice(0, PART_LINES);
      if (lines.length) parts.push({ key, title, lines });
    } catch {
      onSkip?.(key);
    }
  };
  await add("weather", "Weather", settings.weather, sources.weather && (async () => (await sources.weather!()).split("\n").slice(0, 2)));
  await add("events", "Today's events", settings.events, sources.events && (async () => bullets(await sources.events!())));
  await add("reminders", "Open reminders", settings.reminders, sources.reminders && (async () => bullets(await sources.reminders!())));
  await add("tasks", "Finished while you were away", settings.tasks, sources.tasks && (() => sources.tasks!(sinceIso)));
  await add("needsYou", "Waiting for you", settings.needsYou, sources.needsYou && (() => sources.needsYou!()));
  await add("timers", "Timers", true, sources.timers && (() => sources.timers!()));
  return { parts };
}

/** The data as the model reads it: only what was gathered, as data. */
export function dataText(data: BriefData): string {
  return data.parts.map((p) => `${p.title}:\n${p.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
}
