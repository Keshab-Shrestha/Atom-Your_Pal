import type { DatabaseSync } from "node:sqlite";

// ADR-091: the tokens every Claude run used (a worker's task or ATOM's own chat answer), for the Dashboard. Counts and
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
  /** Job 1 (token cost): the chat this call belongs to (the turn or its background note). */
  chatId?: string;
  /** How long Claude keeps the written cache, when the run says ("5m" or "1h"). */
  cacheTtl?: string;
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
  /** The last 7 days by worker (null: ATOM's chat), most tokens first. */
  byWorker: (UsageTotals & { helper: string | null })[];
  /** The last 7 days by model, most tokens first. */
  byModel: (UsageTotals & { model: string })[];
  /** ADR-098 item 9: ATOM's last chat answers read nothing from the prompt cache. */
  chatCacheCold: boolean;
}

/** ADR-098 item 9: how many of the newest chat answers must all miss the cache for "Cache went cold". */
export const COLD_CACHE_RUNS = 3;

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
  // Safe ALTER: an older database gets the new nullable columns; old rows keep NULL.
  const columns = new Set((db.prepare("PRAGMA table_info(usage)").all() as { name: string }[]).map((c) => c.name));
  if (!columns.has("chat_id")) db.exec("ALTER TABLE usage ADD COLUMN chat_id TEXT");
  if (!columns.has("gap_ms")) db.exec("ALTER TABLE usage ADD COLUMN gap_ms INTEGER");
  if (!columns.has("cache_ttl")) db.exec("ALTER TABLE usage ADD COLUMN cache_ttl TEXT");
  const insert = db.prepare(
    "INSERT INTO usage (at, source, helper, job_id, model, input, output, cache_read, cache_write, dollars, chat_id, gap_ms, cache_ttl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const newestOfChat = db.prepare("SELECT at FROM usage WHERE chat_id = ? AND model = ? ORDER BY id DESC LIMIT 1");
  /** chat id + model → time of the last call, in ms. Seeded lazily from the table. */
  const lastCallAt = new Map<string, number>();
  const prune = db.prepare("DELETE FROM usage WHERE at < ?");
  const lastChats = db.prepare("SELECT cache_read FROM usage WHERE source = 'chat' ORDER BY id DESC LIMIT ?");
  const since = db.prepare("SELECT at, helper, source, model, input, output, cache_read, cache_write, dollars FROM usage WHERE at >= ? ORDER BY at");

  return {
    /** Records one run. Returns the gap (ms) since the last call of the same chat and model; null for the first or without a chat. */
    add(entry: UsageEntry): { gapMs: number | null } {
      const at = now();
      const model = entry.model.slice(0, 80);
      const chatId = entry.chatId?.slice(0, 80) || null;
      let gapMs: number | null = null;
      if (chatId) {
        const key = `${chatId}\n${model}`;
        let last = lastCallAt.get(key);
        if (last === undefined) {
          const row = newestOfChat.get(chatId, model) as { at: string } | undefined;
          last = row ? Date.parse(row.at) : undefined;
        }
        if (last !== undefined && Number.isFinite(last)) gapMs = Math.max(0, at.getTime() - last);
        lastCallAt.set(key, at.getTime());
      }
      insert.run(at.toISOString(), entry.source, entry.helper ?? null, entry.job ?? null, model,
        count(entry.input), count(entry.output), count(entry.cacheRead), count(entry.cacheWrite),
        typeof entry.dollars === "number" && entry.dollars > 0 ? entry.dollars : 0,
        chatId, gapMs, entry.cacheTtl?.slice(0, 8) || null);
      prune.run(new Date(at.getTime() - USAGE_KEEP_DAYS * 86_400_000).toISOString());
      return { gapMs };
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
        chatCacheCold: (() => {
          const last = lastChats.all(COLD_CACHE_RUNS) as { cache_read: number }[];
          return last.length === COLD_CACHE_RUNS && last.every((r) => Number(r.cache_read) === 0);
        })(),
      };
    },
  };
}
