import type { DatabaseSync } from "node:sqlite";
import { checkedBriefPreparation, type BriefPreparation, type PreparationBudget } from "./brief-preparation.ts";

// Daily brief (upgrades.md C3): the briefs ATOM wrote and the settings for writing them. A brief holds a few short lines made
// from the user's day (events, reminders, weather, tasks, what needs him). It stays on this Mac. The log never has its text.

/** The brief history keeps this many days. */
export const BRIEF_HISTORY_DAYS = 14;
/** The longest line of a brief that is kept. */
export const BRIEF_LINE_CHARS = 200;
export const BRIEF_MAX_LINES = 8;

export interface BriefSettings {
  /** Off until the user turns it on: a brief costs one short model run a day. */
  enabled: boolean;
  /** Minutes after midnight, local time; default 08:00. */
  minute: number;
  events: boolean;
  reminders: boolean;
  weather: boolean;
  tasks: boolean;
  needsYou: boolean;
  /** A macOS notification when a brief is ready. */
  notify: boolean;
  /** A message to the Telegram chat, when Telegram is set up. */
  telegram: boolean;
  /** ATOM says the brief aloud (default off). */
  spoken: boolean;
  /** Opt-in read-only prepared cards; shares this brief's selected sources and schedule. */
  preparation?: boolean;
  preparationDailyLimit?: number;
  /** Explicit note IDs for private preparation only; never ordinary brief delivery. */
  preparationNoteIds?: number[];
}

export const DEFAULT_BRIEF_SETTINGS: BriefSettings = {
  enabled: false,
  minute: 8 * 60,
  events: true,
  reminders: true,
  weather: true,
  tasks: true,
  needsYou: true,
  notify: true,
  telegram: false,
  spoken: false,
  preparation: false,
  preparationDailyLimit: 2,
  preparationNoteIds: [],
};

export interface Brief {
  id: number;
  /** The local day it is for, YYYY-MM-DD. */
  day: string;
  createdAt: Date;
  lines: string[];
  /** "model": written by the model; "template": the plain version (no input, a used preparation budget or a model failure). */
  source: "model" | "template";
  preparation?: BriefPreparation;
}

export class BriefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefError";
  }
}

export interface Briefs {
  settings(): BriefSettings;
  /** Changes the given settings. Throws BriefError, with words for the user, for a value that is not allowed. */
  update(change: Partial<BriefSettings>): BriefSettings;
  save(input: { day: string; lines: readonly string[]; source: Brief["source"]; preparation?: BriefPreparation }): Brief;
  preparationBudget?(day: string): PreparationBudget;
  reservePreparation?(day: string): boolean;
  /** The newest brief, or undefined. */
  latest(): Brief | undefined;
  /** The newest first, at most `limit`. */
  history(limit?: number): Brief[];
  /** Called after a brief is saved or the settings change. Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}

type Row = { id: number; day: string; created_at: string; lines: string; source: string; preparation: string | null };
const toBrief = (r: Row): Brief => {
  let preparation: BriefPreparation | undefined;
  if (r.preparation) {
    try { preparation = checkedBriefPreparation(JSON.parse(r.preparation)); }
    catch { preparation = { status: "failed", cards: [] }; } // a damaged derived copy never hides the original brief
  }
  return { id: r.id, day: r.day, createdAt: new Date(r.created_at), lines: JSON.parse(r.lines) as string[], source: r.source === "template" ? "template" : "model", ...(preparation ? { preparation } : {}) };
};

const FLAGS = ["enabled", "events", "reminders", "weather", "tasks", "needsYou", "notify", "telegram", "spoken", "preparation"] as const;

export function openBriefs(db: DatabaseSync, now: () => Date): Briefs {
  db.exec(`
    CREATE TABLE IF NOT EXISTS briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      created_at TEXT NOT NULL,
      lines TEXT NOT NULL,
      source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS brief_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS brief_preparation_usage (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL);
  `);
  if (!(db.prepare("PRAGMA table_info(briefs)").all() as { name: string }[]).some((column) => column.name === "preparation")) db.exec("ALTER TABLE briefs ADD COLUMN preparation TEXT");
  const insert = db.prepare("INSERT INTO briefs (day, created_at, lines, source, preparation) VALUES (?, ?, ?, ?, ?)");
  const readAttempts = db.prepare("SELECT attempts FROM brief_preparation_usage WHERE day = ?");
  const reserve = db.prepare(`INSERT INTO brief_preparation_usage(day, attempts) VALUES (?, 1)
    ON CONFLICT(day) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ?`);
  const pruneAttempts = db.prepare("DELETE FROM brief_preparation_usage WHERE day < ?");
  const byId = db.prepare("SELECT * FROM briefs WHERE id = ?");
  const newest = db.prepare("SELECT * FROM briefs ORDER BY id DESC LIMIT ?");
  const prune = db.prepare("DELETE FROM briefs WHERE created_at < ?");
  const read = db.prepare("SELECT value FROM brief_settings WHERE key = 'settings'");
  const write = db.prepare("INSERT INTO brief_settings (key, value) VALUES ('settings', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // a listener never stops the others
      }
    }
  };

  const settings = (): BriefSettings => {
    const row = read.get() as { value: string } | undefined;
    if (!row) return { ...DEFAULT_BRIEF_SETTINGS, preparationNoteIds: [] };
    try {
      const saved = JSON.parse(row.value) as Partial<BriefSettings>;
      // A value that is not allowed reads as the default: a damaged row never stops the brief.
      const out = { ...DEFAULT_BRIEF_SETTINGS, preparationNoteIds: [] as number[] };
      for (const key of FLAGS) if (typeof saved[key] === "boolean") out[key] = saved[key] as boolean;
      if (Number.isInteger(saved.minute) && saved.minute! >= 0 && saved.minute! < 1440) out.minute = saved.minute!;
      if (Number.isInteger(saved.preparationDailyLimit) && saved.preparationDailyLimit! >= 1 && saved.preparationDailyLimit! <= 5) out.preparationDailyLimit = saved.preparationDailyLimit;
      if (Array.isArray(saved.preparationNoteIds) && saved.preparationNoteIds.length <= 12 && saved.preparationNoteIds.every((id) => Number.isSafeInteger(id) && id > 0)) out.preparationNoteIds = [...new Set(saved.preparationNoteIds)];
      return out;
    } catch {
      return { ...DEFAULT_BRIEF_SETTINGS, preparationNoteIds: [] };
    }
  };

  return {
    settings,

    update(change) {
      const next = settings();
      for (const key of FLAGS) {
        const value = change[key];
        if (value === undefined) continue;
        if (typeof value !== "boolean") throw new BriefError(`"${key}" is on or off.`);
        next[key] = value;
      }
      if (change.minute !== undefined) {
        if (!Number.isInteger(change.minute) || change.minute < 0 || change.minute >= 1440) throw new BriefError("The time is a minute of the day, from 0 to 1439.");
        next.minute = change.minute;
      }
      if (change.preparationDailyLimit !== undefined) {
        if (!Number.isInteger(change.preparationDailyLimit) || change.preparationDailyLimit < 1 || change.preparationDailyLimit > 5) throw new BriefError("Preparation allows one to five model attempts per local day.");
        next.preparationDailyLimit = change.preparationDailyLimit;
      }
      if (change.preparationNoteIds !== undefined) {
        const ids = change.preparationNoteIds;
        if (!Array.isArray(ids) || ids.length > 12 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw new BriefError("Choose up to twelve distinct saved notes for preparation.");
        next.preparationNoteIds = [...ids];
      }
      write.run(JSON.stringify(next));
      changed();
      return next;
    },

    preparationBudget(day) {
      return { day, used: (readAttempts.get(day) as { attempts: number } | undefined)?.attempts ?? 0, limit: settings().preparationDailyLimit ?? 2 };
    },

    reservePreparation(day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !settings().preparation) return false;
      const result = reserve.run(day, settings().preparationDailyLimit ?? 2);
      // Bounded ledger retention without clock-based re-admission for the same recent day.
      pruneAttempts.run(new Date(now().getTime() - 30 * 86_400_000).toISOString().slice(0, 10));
      return result.changes > 0;
    },

    save({ day, lines, source, preparation }) {
      const clean = lines.map((l) => l.replace(/\s+/g, " ").trim().slice(0, BRIEF_LINE_CHARS)).filter(Boolean).slice(0, BRIEF_MAX_LINES);
      if (!clean.length) throw new BriefError("A brief needs at least one line.");
      const at = now();
      const prepared = preparation ? JSON.stringify(checkedBriefPreparation(preparation)) : null;
      const id = Number(insert.run(day, at.toISOString(), JSON.stringify(clean), source, prepared).lastInsertRowid);
      prune.run(new Date(at.getTime() - BRIEF_HISTORY_DAYS * 86_400_000).toISOString());
      changed();
      return toBrief(byId.get(id) as unknown as Row);
    },

    latest() {
      const row = (newest.all(1) as unknown as Row[])[0];
      return row ? toBrief(row) : undefined;
    },

    history(limit = BRIEF_HISTORY_DAYS) {
      return (newest.all(Math.max(1, Math.min(limit, 50))) as unknown as Row[]).map(toBrief);
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
