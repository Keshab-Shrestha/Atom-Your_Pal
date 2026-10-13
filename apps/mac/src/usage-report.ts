import type { Logger } from "@atom/shared";
import type { TokenMeta, TokenUsage } from "@atom/llm-gateway";
import type { UsageEntry } from "@atom/helpers";

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
