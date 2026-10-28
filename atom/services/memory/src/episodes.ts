import type { LanguageModel, Message } from "@atom/contracts";
import type { Episode, MemoryStore } from "./store.ts";

// ADR-059: a short summary of each conversation, made in the background, so the next conversation (after "New
// conversation" or a restart) can pick up where this one left off. ADR-108: written once when the chat goes quiet or is left.

export const SUMMARY_PROMPT =
  "You write ATOM's private notes about a conversation between the user and ATOM, a voice assistant. In at most two " +
  "short sentences (under 60 words), note what the user wanted, what was done or decided, and anything left open, so " +
  "a later conversation can pick up from it. Call the user by name if you know it, else \"the user\". Plain text only. Leave out greetings, " +
  "small talk, and any password, PIN, card number or other secret. If nothing worth noting happened (only a greeting " +
  "or a one-off fact question), reply with exactly: NOTHING";

/** ADR-108: a chat is noted after this long without a reply (10 minutes). */
export const NOTE_QUIET_MS = 600_000;
/** ADR-108: a chat with fewer exchanges than this gets no note (when notes wait for quiet). */
export const NOTE_MIN_EXCHANGES = 2;

/** ADR-108: `ATOM_NOTE_QUIET_MS` as milliseconds; a missing or bad value is the default; 0 notes after every reply. */
export function noteQuietMs(value: string | undefined): number {
  const n = value === undefined || value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NOTE_QUIET_MS;
}

export interface EpisodeRecorderOptions {
  store: MemoryStore;
  /** The model that writes summaries; one short request per note. */
  model: LanguageModel;
  /**
   * ADR-108: how long a chat must stay quiet before its note is written (default 10 minutes). Each new reply restarts the
   * wait. 0 writes after every reply, as before ADR-108, and also notes a chat with one exchange.
   */
  quietMs?: number;
  /** For the log: ids and counts, never the summary text. */
  onSaved?: (event: { id: number; exchanges: number }) => void;
  onError?: (error: unknown) => void;
}

export interface EpisodeRecorder {
  /**
   * The conversation changed: `turns` is the whole session so far. Never throws and never delays the caller. The note
   * is written when the chat has been quiet for `quietMs`; a newer update restarts the wait and replaces the turns.
   */
  update(sessionId: string, turns: readonly Message[]): void;
  /**
   * Writes the note of one chat now (or of every chat that waits), if it has new exchanges. For a chat that is left
   * (another chat opened, a new chat) and for quitting. Resolves when the notes are written.
   */
  flush(sessionId?: string): Promise<void>;
  /** The chat was deleted: its waiting note is dropped, and no note is written for it. */
  discard(sessionId: string): void;
  /** Resolves when no summary is being written (for tests and quitting). */
  idle(): Promise<void>;
}

export function createEpisodeRecorder(options: EpisodeRecorderOptions): EpisodeRecorder {
  const { store, model, quietMs = NOTE_QUIET_MS, onSaved, onError } = options;
  const minExchanges = quietMs === 0 ? 1 : NOTE_MIN_EXCHANGES;
  const latest = new Map<string, readonly Message[]>(); // session → newest turns, not yet noted
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const queued = new Set<string>();
  let chain: Promise<void> = Promise.resolve();

  const exchangesOf = (turns: readonly Message[]) => turns.filter((t) => t.role === "assistant").length;

  async function write(sessionId: string, turns: readonly Message[]) {
    const exchanges = exchangesOf(turns);
    const transcript = turns
      .map((t) => `${t.role === "user" ? "User" : "ATOM"}: ${t.content.replace(/\s+/g, " ").trim().slice(0, 600)}`)
      .join("\n");
    const reply = await model.complete({
      system: SUMMARY_PROMPT,
      messages: [{ role: "user", content: `The conversation:\n${transcript}` }],
      context: { requestId: `summary-${sessionId}-${exchanges}`, sessionId, source: "text", receivedAt: new Date(), background: true },
    });
    const summary = reply.text.trim();
    if (!summary || /^NOTHING\b/i.test(summary)) return;
    const episode = store.saveEpisode(sessionId, summary, exchanges);
    onSaved?.({ id: episode.id, exchanges });
  }

  /** Queues the note of one chat. The turns are read when it runs, so a newer update before then is used. */
  function enqueue(sessionId: string) {
    clearTimeout(timers.get(sessionId));
    timers.delete(sessionId);
    if (queued.has(sessionId)) return;
    queued.add(sessionId);
    chain = chain.then(async () => {
      queued.delete(sessionId);
      const turns = latest.get(sessionId);
      latest.delete(sessionId);
      if (!turns) return;
      if (exchangesOf(turns) < minExchanges) return; // `latest` holds only exchanges not noted yet
      try {
        await write(sessionId, turns);
      } catch (error) {
        onError?.(error);
      }
    });
  }

  const recorder: EpisodeRecorder = {
    update(sessionId, turns) {
      if (exchangesOf(turns) === 0) return;
      latest.set(sessionId, [...turns]);
      if (quietMs === 0) return enqueue(sessionId);
      clearTimeout(timers.get(sessionId));
      const timer = setTimeout(() => enqueue(sessionId), quietMs);
      timer.unref?.(); // a waiting note never keeps the program alive; quitting flushes it
      timers.set(sessionId, timer);
    },
    flush(sessionId) {
      for (const id of sessionId === undefined ? [...latest.keys()] : latest.has(sessionId) ? [sessionId] : []) enqueue(id);
      return recorder.idle();
    },
    discard(sessionId) {
      clearTimeout(timers.get(sessionId));
      timers.delete(sessionId);
      latest.delete(sessionId);
    },
    async idle() {
      for (;;) {
        const current = chain;
        await current;
        if (current === chain) return; // nothing was queued while waiting
      }
    },
  };
  return recorder;
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
