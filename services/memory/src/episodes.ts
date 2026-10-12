import type { LanguageModel, Message } from "@atom/contracts";
import type { Episode, MemoryStore } from "./store.ts";

// ADR-059: a short summary of each conversation, made in the background after a reply, so the next conversation
// (after "New conversation" or a restart) can pick up where this one left off.

export const SUMMARY_PROMPT =
  "You write ATOM's private notes about a conversation between the user and ATOM, a voice assistant. In at most two " +
  "short sentences (under 60 words), note what the user wanted, what was done or decided, and anything left open, so " +
  "a later conversation can pick up from it. Call the user by name if you know it, else \"the user\". Plain text only. Leave out greetings, " +
  "small talk, and any password, PIN, card number or other secret. If nothing worth noting happened (only a greeting " +
  "or a one-off fact question), reply with exactly: NOTHING";

export interface EpisodeRecorderOptions {
  store: MemoryStore;
  /** The model that writes summaries; one short request per update. */
  model: LanguageModel;
  /** Summaries are rewritten after this many new exchanges in a session (default 1: after every reply). */
  every?: number;
  /** For the log: ids and counts, never the summary text. */
  onSaved?: (event: { id: number; exchanges: number }) => void;
  onError?: (error: unknown) => void;
}

export interface EpisodeRecorder {
  /**
   * The conversation changed: `turns` is the whole session so far. Summarises in the background; never throws
   * and never delays the caller. Updates for one session are serialised, and only the newest is kept.
   */
  update(sessionId: string, turns: readonly Message[]): void;
  /** Resolves when no summary is being written (for tests and quitting). */
  idle(): Promise<void>;
}

export function createEpisodeRecorder(options: EpisodeRecorderOptions): EpisodeRecorder {
  const { store, model, every = 1, onSaved, onError } = options;
  const summarised = new Map<string, number>(); // session → exchanges in its last summary
  let chain: Promise<void> = Promise.resolve();
  let pending: { sessionId: string; turns: readonly Message[] } | undefined;

  async function write(sessionId: string, turns: readonly Message[]) {
    const exchanges = turns.filter((t) => t.role === "assistant").length;
    const transcript = turns
      .map((t) => `${t.role === "user" ? "User" : "ATOM"}: ${t.content.replace(/\s+/g, " ").trim().slice(0, 600)}`)
      .join("\n");
    const reply = await model.complete({
      system: SUMMARY_PROMPT,
      messages: [{ role: "user", content: `The conversation:\n${transcript}` }],
      context: { requestId: `summary-${sessionId}-${exchanges}`, sessionId, source: "text", receivedAt: new Date(), background: true },
    });
    summarised.set(sessionId, exchanges);
    const summary = reply.text.trim();
    if (!summary || /^NOTHING\b/i.test(summary)) return;
    const episode = store.saveEpisode(sessionId, summary, exchanges);
    onSaved?.({ id: episode.id, exchanges });
  }

  return {
    update(sessionId, turns) {
      const exchanges = turns.filter((t) => t.role === "assistant").length;
      if (exchanges === 0) return;
      if (exchanges - (summarised.get(sessionId) ?? 0) < every) return;
      const queued = pending !== undefined;
      pending = { sessionId, turns: [...turns] };
      if (queued) return; // the queued run will pick up this newer conversation
      chain = chain.then(async () => {
        const job = pending!;
        pending = undefined;
        try {
          await write(job.sessionId, job.turns);
        } catch (error) {
          onError?.(error);
        }
      });
    },
    async idle() {
      for (;;) {
        const current = chain;
        await current;
        if (current === chain) return; // nothing was queued while waiting
      }
    },
  };
}

/** Past conversations for the system prompt: the newest few, oldest first, excluding the current session. */
export function episodeContext(store: MemoryStore, currentSessionId: string, limit = 3): string | undefined {
  const episodes = store.episodes(limit + 1).filter((e) => e.sessionId !== currentSessionId).slice(0, limit);
  if (episodes.length === 0) return undefined;
  return [
    "Your notes from recent conversations with the user (use them if the user refers back; do not bring them up unprompted). " +
      "They record what happened then, not what you can do now: if a note says you could not do something, try again with the tools you have.",
    ...episodes.reverse().map((e) => `- ${when(e)}: ${e.summary}`),
  ].join("\n");
}

function when(e: Episode): string {
  const minutes = Math.round((Date.now() - e.endedAt.getTime()) / 60_000);
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
