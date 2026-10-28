/**
 * Daily brief (upgrades.md C3): when a brief is due. Pure: no clock of its own, no store. One brief a day, at or after the set
 * time, in the Mac's time zone. A Mac that slept through the time makes the brief at its first tick after waking.
 */

const parts = (now: Date, timeZone?: string) => {
  const f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timeZone ? { timeZone } : {}) });
  return Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value])) as Record<string, string>;
};

/** The local day as YYYY-MM-DD. */
export function localDay(now: Date, timeZone?: string): string {
  const p = parts(now, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Minutes after local midnight. */
export function localMinute(now: Date, timeZone?: string): number {
  const p = parts(now, timeZone);
  return Number(p.hour) * 60 + Number(p.minute);
}

export interface BriefDueInput {
  enabled: boolean;
  /** The set time: minutes after local midnight. */
  minute: number;
  now: Date;
  /** The local day of the newest brief, if any. */
  lastDay?: string;
  timeZone?: string;
}

export function isBriefDue(input: BriefDueInput): boolean {
  if (!input.enabled) return false;
  if (input.lastDay === localDay(input.now, input.timeZone)) return false;
  return localMinute(input.now, input.timeZone) >= input.minute;
}
