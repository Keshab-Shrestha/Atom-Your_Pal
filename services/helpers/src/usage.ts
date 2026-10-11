import type { DatabaseSync } from "node:sqlite";

// ADR-091: the tokens every Claude run used (a worker's task or ZENO's own chat answer), for the Dashboard. Counts and
// model ids only: never a task's or answer's text. Kept 90 days.

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageEntry extends TokenCounts {
  source: "chat" | "job";
  /** The worker, for a job. */
  helper?: string;
  job?: number;
  model: string;
  /** API-equivalent dollars, as Claude Code reports them (the plan does not charge them). */
  dollars?: number;
}

export interface UsageTotals extends TokenCounts {
  dollars: number;
  runs: number;
}

export interface UsageSummary {
  today: UsageTotals;
  week: UsageTotals;
  /** The last 7 days, oldest first, each with its local date (YYYY-MM-DD). */
  days: (UsageTotals & { day: string })[];
  /** The last 7 days by worker (null: ZENO's chat), most tokens first. */
  byWorker: (UsageTotals & { helper: string | null })[];
  /** The last 7 days by model, most tokens first. */
  byModel: (UsageTotals & { model: string })[];
}

export const USAGE_KEEP_DAYS = 90;

const empty = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, dollars: 0, runs: 0 });
const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
export const tokensIn = (t: TokenCounts) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** The local calendar date of `d`. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function add(into: UsageTotals, row: TokenCounts & { dollars: number }) {
  into.input += row.input;
  into.output += row.output;
  into.cacheRead += row.cacheRead;
  into.cacheWrite += row.cacheWrite;
  into.dollars += row.dollars;
  into.runs += 1;
}

export function usageTable(db: DatabaseSync, now: () => Date = () => new Date()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('chat', 'job')),
      helper TEXT,
      job_id INTEGER,
      model TEXT NOT NULL,
      input INTEGER NOT NULL,
      output INTEGER NOT NULL,
      cache_read INTEGER NOT NULL,
      cache_write INTEGER NOT NULL,
      dollars REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS usage_at ON usage (at);
  `);
  const insert = db.prepare(
    "INSERT INTO usage (at, source, helper, job_id, model, input, output, cache_read, cache_write, dollars) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const prune = db.prepare("DELETE FROM usage WHERE at < ?");
  const since = db.prepare("SELECT at, helper, source, model, input, output, cache_read, cache_write, dollars FROM usage WHERE at >= ? ORDER BY at");

  return {
    add(entry: UsageEntry): void {
      const at = now();
      insert.run(at.toISOString(), entry.source, entry.helper ?? null, entry.job ?? null, entry.model.slice(0, 80),
        count(entry.input), count(entry.output), count(entry.cacheRead), count(entry.cacheWrite),
        typeof entry.dollars === "number" && entry.dollars > 0 ? entry.dollars : 0);
      prune.run(new Date(at.getTime() - USAGE_KEEP_DAYS * 86_400_000).toISOString());
    },

    summary(): UsageSummary {
      const today = now();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
      const days = Array.from({ length: 7 }, (_, i) => ({ ...empty(), day: localDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)) }));
      const byDay = new Map(days.map((d) => [d.day, d]));
      const week = empty();
      const workers = new Map<string | null, UsageTotals & { helper: string | null }>();
      const models = new Map<string, UsageTotals & { model: string }>();
      for (const r of since.all(start.toISOString()) as Record<string, unknown>[]) {
        const row = { input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cache_read), cacheWrite: Number(r.cache_write), dollars: Number(r.dollars) };
        const day = byDay.get(localDay(new Date(String(r.at))));
        if (!day) continue;
        add(day, row);
        add(week, row);
        const helper = r.source === "chat" ? null : (r.helper as string | null);
        if (!workers.has(helper)) workers.set(helper, { ...empty(), helper });
        add(workers.get(helper)!, row);
        const model = String(r.model);
        if (!models.has(model)) models.set(model, { ...empty(), model });
        add(models.get(model)!, row);
      }
      const most = <T extends TokenCounts>(a: T, b: T) => tokensIn(b) - tokensIn(a);
      return {
        today: days.at(-1)!,
        week,
        days,
        byWorker: [...workers.values()].sort(most),
        byModel: [...models.values()].sort(most),
      };
    },
  };
}
