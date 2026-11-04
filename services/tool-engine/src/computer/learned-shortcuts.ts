import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Learned shortcuts (2026-11-04, idea from atticus-mac "learn/replay"). A click_sequence that finished with every step
// checked is saved under the app and the goal it served. The same goal later replays the same button labels through the same
// checked click_sequence path: fresh window read, one unique enabled button per step, ordinary click policy, expected
// value after each click, stop at the first mismatch. A shortcut holds only button labels and expected read-only text,
// never coordinates, element tokens, typed text or images. Two failed replays in a row remove it.
// (Not the fixed-phrase instant commands in ../shortcuts.ts.)

export interface ShortcutStep { button: string; expect: { label: string; value: string } }

export interface Shortcut {
  id: string;
  app: string;
  goal: string;
  steps: ShortcutStep[];
  /** Replays that completed. */
  uses: number;
  /** Replays that stopped, since the last one that completed. */
  failures: number;
  savedAt: string;
}

export interface ShortcutStore {
  /** The shortcuts for one app, most used first. */
  forApp(app: string): Shortcut[];
  find(app: string, goal: string): Shortcut | undefined;
  /** Saves (or replaces) the shortcut for this app and goal. */
  save(app: string, goal: string, steps: ShortcutStep[]): Shortcut;
  /** A replay completed (true) or stopped (false). Returns false when the shortcut was removed as stale. */
  record(id: string, ok: boolean): boolean;
  remove(id: string): boolean;
  all(): Shortcut[];
}

export const MAX_SHORTCUTS = 50;
export const MAX_FAILURES = 2;
export const MAX_GOAL_CHARS = 120;

/** Same goal in other case, spacing or final punctuation. */
export const foldGoal = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/[.!?。]+$/u, "").trim();
const key = (app: string, goal: string) => `${app.trim().toLowerCase()}\u0000${foldGoal(goal)}`;

/** Held in memory; `path` (when given) is read once and rewritten after each change. An unreadable file reads as none. */
export function createShortcutStore(options: { path?: string; now?: () => Date; newId?: () => string } = {}): ShortcutStore {
  const now = options.now ?? (() => new Date());
  let counter = 0;
  const newId = options.newId ?? (() => `s${now().getTime().toString(36)}${(counter++).toString(36)}`);
  let items: Shortcut[] = [];
  if (options.path) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(options.path, "utf8"));
      if (Array.isArray(parsed)) items = parsed.filter((s): s is Shortcut => Boolean(s) && typeof s.id === "string" && typeof s.app === "string" && typeof s.goal === "string" && Array.isArray(s.steps));
    } catch { /* no file yet, or damaged: start empty */ }
  }
  const persist = () => {
    if (!options.path) return;
    try {
      mkdirSync(dirname(options.path), { recursive: true });
      const temp = `${options.path}.tmp`;
      writeFileSync(temp, JSON.stringify(items), { mode: 0o600 });
      renameSync(temp, options.path);
    } catch { /* a shortcut not written is a shortcut not kept; the tool still works */ }
  };

  return {
    all: () => [...items],
    forApp: (app) => items.filter((s) => s.app.toLowerCase() === app.trim().toLowerCase()).sort((a, b) => b.uses - a.uses),
    find: (app, goal) => items.find((s) => key(s.app, s.goal) === key(app, goal)),
    save(app, goal, steps) {
      const trimmed = goal.replace(/\s+/g, " ").trim().slice(0, MAX_GOAL_CHARS);
      const previous = items.find((s) => key(s.app, s.goal) === key(app, trimmed));
      const saved: Shortcut = { id: previous?.id ?? newId(), app, goal: trimmed, steps, uses: previous?.uses ?? 0, failures: 0, savedAt: now().toISOString() };
      items = [...items.filter((s) => s !== previous), saved];
      if (items.length > MAX_SHORTCUTS) items = [...items].sort((a, b) => b.uses - a.uses || b.savedAt.localeCompare(a.savedAt)).slice(0, MAX_SHORTCUTS);
      persist();
      return saved;
    },
    record(id, ok) {
      const found = items.find((s) => s.id === id);
      if (!found) return false;
      const next = ok ? { ...found, uses: found.uses + 1, failures: 0 } : { ...found, failures: found.failures + 1 };
      const keep = next.failures < MAX_FAILURES;
      items = keep ? items.map((s) => (s === found ? next : s)) : items.filter((s) => s !== found);
      persist();
      return keep;
    },
    remove(id) {
      const before = items.length;
      items = items.filter((s) => s.id !== id);
      if (items.length === before) return false;
      persist();
      return true;
    },
  };
}
