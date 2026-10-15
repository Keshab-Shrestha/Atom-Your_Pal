import type { DatabaseSync } from "node:sqlite";
import { dollarsFor } from "./pricing.ts";

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
  /** API-equivalent dollars as Claude Code reported them. Kept as `dollars_sdk`; the dollars used are priced from the tokens (pricing.ts) when the model has a price, else these. */
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

/** Job 4 (token cost): one recent call, for the Dashboard's list of turns. Counts and a model id only, never text. */
export interface RecentRun extends TokenCounts {
  /** ISO time the call ended. */
  at: string;
  /** "turn": a chat answer; "note": the conversation note; "job": a worker's run; "other": calls Claude Code made itself. */
  kind: "turn" | "note" | "job" | "other";
  model: string;
  /** Milliseconds since the last call of the same chat and model; absent for the first. */
  gapMs?: number;
}

/** The `helper` of a row that holds the calls Claude Code made itself (reading a web page, its small model). */
export const OVERHEAD_HELPER = "claude-code";

/** How many recent calls the summary lists. */
export const RECENT_RUNS = 8;

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
  /** Job 4: the newest calls, newest first. */
  recent: RecentRun[];
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
  if (!columns.has("dollars_sdk")) {
    // 2026-10-15: dollars are priced from each row's own tokens (pricing.ts). Claude Code's own cost is a running total for
    // the session, so a chat row held its background agents' cost and the agents' rows held none. Keep what it reported
    // (dollars_sdk), then price every old row whose model has a price. A row with no ttl is priced as a 1-hour write.
    db.exec("BEGIN");
    try {
      db.exec("ALTER TABLE usage ADD COLUMN dollars_sdk REAL");
      db.exec("UPDATE usage SET dollars_sdk = dollars");
      const old = db.prepare("SELECT id, model, input, output, cache_read, cache_write, cache_ttl FROM usage").all() as {
        id: number; model: string; input: number; output: number; cache_read: number; cache_write: number; cache_ttl: string | null;
      }[];
      const reprice = db.prepare("UPDATE usage SET dollars = ? WHERE id = ?");
      for (const row of old) {
        const dollars = dollarsFor(row.model, { input: row.input, output: row.output, cacheRead: row.cache_read, cacheWrite: row.cache_write }, row.cache_ttl ?? undefined);
        if (dollars !== undefined) reprice.run(dollars, row.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const insert = db.prepare(
    "INSERT INTO usage (at, source, helper, job_id, model, input, output, cache_read, cache_write, dollars, chat_id, gap_ms, cache_ttl, dollars_sdk) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const newestOfChat = db.prepare("SELECT at FROM usage WHERE chat_id = ? AND model = ? ORDER BY id DESC LIMIT 1");
  /** chat id + model → time of the last call, in ms. Seeded lazily from the table. */
  const lastCallAt = new Map<string, number>();
  const prune = db.prepare("DELETE FROM usage WHERE at < ?");
  const lastChats = db.prepare("SELECT cache_read FROM usage WHERE source = 'chat' ORDER BY id DESC LIMIT ?");
  const newest = db.prepare("SELECT at, source, helper, model, input, output, cache_read, cache_write, gap_ms FROM usage ORDER BY id DESC LIMIT ?");
  // 2026-10-15: what the table holds for one chat and model, for the "Other" rows (usage-overhead.ts). A conversation note is
  // another process, so it is not part of the chat session's own totals.
  const recordedOf = db.prepare(
    "SELECT COALESCE(SUM(input),0) AS input, COALESCE(SUM(output),0) AS output, COALESCE(SUM(cache_read),0) AS cache_read, COALESCE(SUM(cache_write),0) AS cache_write FROM usage WHERE chat_id = ? AND model = ? AND COALESCE(helper, '') != 'note'",
  );
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
      const tokens = { input: count(entry.input), output: count(entry.output), cacheRead: count(entry.cacheRead), cacheWrite: count(entry.cacheWrite) };
      insert.run(at.toISOString(), entry.source, entry.helper ?? null, entry.job ?? null, model,
        tokens.input, tokens.output, tokens.cacheRead, tokens.cacheWrite,
        // Priced from this row's own (cleaned) tokens; a model with no price falls back to what Claude Code reported.
        dollarsFor(model, tokens, entry.cacheTtl) ?? (typeof entry.dollars === "number" && entry.dollars > 0 ? entry.dollars : 0),
        chatId, gapMs, entry.cacheTtl?.slice(0, 8) || null, typeof entry.dollars === "number" && entry.dollars > 0 ? entry.dollars : null);
      prune.run(new Date(at.getTime() - USAGE_KEEP_DAYS * 86_400_000).toISOString());
      return { gapMs };
    },

    /** The tokens already recorded for a chat's session on one model (notes excluded). */
    recorded(chatId: string, model: string): TokenCounts {
      const r = recordedOf.get(chatId, model.slice(0, 80)) as Record<string, number>;
      return { input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cache_read), cacheWrite: Number(r.cache_write) };
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
        recent: (newest.all(RECENT_RUNS) as Record<string, unknown>[]).map((r) => ({
          at: String(r.at),
          kind: r.source === "job" ? ("job" as const) : r.helper === "note" ? ("note" as const) : r.helper === OVERHEAD_HELPER ? ("other" as const) : ("turn" as const),
          model: String(r.model),
          input: Number(r.input),
          output: Number(r.output),
          cacheRead: Number(r.cache_read),
          cacheWrite: Number(r.cache_write),
          ...(typeof r.gap_ms === "number" ? { gapMs: r.gap_ms } : {}),
        })),
        chatCacheCold: (() => {
          const last = lastChats.all(COLD_CACHE_RUNS) as { cache_read: number }[];
          return last.length === COLD_CACHE_RUNS && last.every((r) => Number(r.cache_read) === 0);
        })(),
      };
    },
  };
}
