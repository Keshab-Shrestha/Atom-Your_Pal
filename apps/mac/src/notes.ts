import type { LanguageModel } from "@atom/contracts";
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
