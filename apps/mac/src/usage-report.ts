import type { Logger } from "@atom/shared";
import type { ModelTotal, TokenMeta, TokenUsage } from "@atom/llm-gateway";
import { OVERHEAD_HELPER, type HelperStore, type TokenCounts, type UsageEntry } from "@atom/helpers";

// Job 1 (token cost): records one chat answer or its background note. The chat id and the gap since the chat's last
// call (same model) go in the usage table; the log line gets names and numbers only, never text.

export function createChatUsageRecorder(
  helpers: { addUsage(entry: UsageEntry): { gapMs: number | null } | void } | undefined,
  log: Pick<Logger, "info">,
) {
  return (tokens: TokenUsage, model: string, meta?: TokenMeta): void => {
    const added = helpers?.addUsage({
      source: "chat",
      model,
      input: tokens.input,
      output: tokens.output,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      ...(tokens.costUsd ? { dollars: tokens.costUsd } : {}),
      ...(tokens.cacheTtl ? { cacheTtl: tokens.cacheTtl } : {}),
      ...(meta?.chatId ? { chatId: meta.chatId } : {}),
      ...(meta?.background ? { helper: "note" } : {}),
    });
    log.info("usage.turn", {
      source: meta?.background ? "note" : "chat",
      model,
      ...(added && added.gapMs !== null ? { gapMs: added.gapMs } : {}), // absent for the first call of a chat
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      input: tokens.input,
      output: tokens.output,
    });
  };
}

/** How long to wait after a result before comparing totals: an agent's last rows arrive a moment after the turn's result. */
export const OVERHEAD_SETTLE_MS = 3000;

/**
 * 2026-10-15: the calls Claude Code makes itself (it reads a fetched web page with a small model, and a session starts with one
 * more) and the output tokens of an agent's message that the first stream event cut short are in no row. Claude Code's running
 * totals per model (`modelUsage`) hold them. After a turn has settled, what the totals have and the table lacks for that chat
 * and model goes in one "Other" row (helper `claude-code`). The comparison is of running totals, so a missed turn is caught by
 * the next. A resumed session starts with earlier totals: its first result only sets the base, nothing is booked for the past.
 */
export function createOverheadRecorder(
  helpers: Pick<HelperStore, "addUsage" | "recordedUsage"> | undefined,
  log: Pick<Logger, "info">,
  settleMs: number = OVERHEAD_SETTLE_MS,
) {
  const base = new Map<string, TokenCounts>();
  const latest = new Map<string, Record<string, ModelTotal>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const fields = ["input", "output", "cacheRead", "cacheWrite"] as const;
  const missing = (total: TokenCounts, recorded: TokenCounts, from?: TokenCounts): TokenCounts =>
    Object.fromEntries(fields.map((f) => [f, Math.max(0, total[f] - recorded[f] - (from?.[f] ?? 0))])) as unknown as TokenCounts;

  const settle = (chatId: string, first: boolean, resumed: boolean) => {
    const totals = latest.get(chatId);
    if (!helpers || !totals) return;
    for (const [model, total] of Object.entries(totals)) {
      const key = `${chatId}\n${model}`;
      const recorded = helpers.recordedUsage(chatId, model);
      if (first && resumed && !base.has(key)) {
        base.set(key, missing(total, recorded));
        continue;
      }
      const extra = missing(total, recorded, base.get(key));
      if (fields.every((f) => extra[f] === 0)) continue;
      helpers.addUsage({ source: "chat", helper: OVERHEAD_HELPER, model, chatId, ...extra });
      log.info("usage.other", { model, ...extra });
    }
  };

  return (totals: Record<string, ModelTotal>, meta: { chatId: string; resumed: boolean; first: boolean; background: number }): void => {
    latest.set(meta.chatId, totals);
    // A resumed session's first result sets the base now, before any new row exists.
    if (meta.first && meta.resumed) {
      settle(meta.chatId, true, true);
      return;
    }
    // Agents still run: their rows are on the way. The result that ends them comes later and books the difference.
    if (meta.background > 0) return;
    clearTimeout(timers.get(meta.chatId));
    const timer = setTimeout(() => {
      timers.delete(meta.chatId);
      try {
        settle(meta.chatId, false, meta.resumed);
      } catch (error) {
        log.info("usage.other_failed", { error: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
      }
    }, settleMs);
    timer.unref?.();
    timers.set(meta.chatId, timer);
  };
}
