import type { LanguageModel } from "@atom/contracts";
import { runNote, type ClaudeSdk, type PlanUsage, type TokenMeta, type TokenUsage } from "@atom/llm-gateway";
import { createEpisodeRecorder, noteQuietMs, type EpisodeRecorder, type MemoryStore } from "@atom/memory";
import { readEnv, type Logger } from "@atom/shared";
import { errorFields } from "./runtime-support.ts";

/**
 * ADR-059, ADR-108: the recorder of conversation notes. Off without memory or with `ATOM_EPISODES=0`.
 * `ATOM_NOTE_QUIET_MS` sets how long a chat stays quiet before its note is written (default 10 minutes; 0 = every reply).
 * The log gets ids and counts, never the note.
 */
export function createNotes(options: {
  memory: MemoryStore | undefined;
  model: LanguageModel;
  env: Record<string, string | undefined>;
  log: Pick<Logger, "info" | "warn">;
  changed: () => void;
}): EpisodeRecorder | undefined {
  const { memory, model, env, log, changed } = options;
  if (!memory || readEnv(env, "ATOM_EPISODES") === "0") return undefined;
  return createEpisodeRecorder({
    store: memory,
    model,
    quietMs: noteQuietMs(readEnv(env, "ATOM_NOTE_QUIET_MS")),
    onSaved: (e) => {
      log.info("episode.saved", e);
      changed();
    },
    onError: (error) => log.warn("episode.failed", { ...errorFields(error) }),
  });
}

/**
 * ADR-108: the model of the conversation note. It is the small model of the Claude plan (the one the chat digest uses),
 * whatever model the chat has, in one run without tools. `smallModel` is read per note, so a change of provider applies
 * at once; without a small model (not on the Claude plan) the note fails and the recorder logs it.
 */
export function createNoteModel(options: {
  claudePath: () => string;
  smallModel: () => string | undefined;
  onUsage?: (usage: PlanUsage) => void;
  onTokens?: (tokens: TokenUsage, model: string, meta?: TokenMeta) => void;
  /** For tests: the Agent SDK. */
  sdk?: ClaudeSdk;
}): LanguageModel {
  return {
    async complete(request, signal) {
      const model = options.smallModel();
      if (!model) throw new Error("Conversation notes need the Claude plan.");
      const { note, tokens } = await runNote({
        claudePath: options.claudePath(),
        model,
        task: request.messages.map((m) => m.content).join("\n\n"),
        instructions: request.system,
        signal: signal ?? AbortSignal.timeout(120_000),
        ...(options.onUsage ? { onUsage: options.onUsage } : {}),
        ...(options.sdk ? { sdk: options.sdk } : {}),
      });
      if (tokens) options.onTokens?.(tokens, model, { chatId: request.context.sessionId, background: true });
      return { text: note };
    },
  };
}
