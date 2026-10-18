// Who is answering in which chat right now, shared by the window and the Local API (the phone page). Two Cores write a shared chat ("api", "api-<id>"), and each
// saves its own history over the chat's file, so two turns at once in one chat overwrote each other's messages. A second turn in a chat that is answering is refused
// at once with a clear line, not queued behind an answer that can take minutes. A chat that is deleted while a turn runs is not saved back when that turn ends
// (2026-10-16, code check).

export type TurnSurface = "window" | "api";

const WORDS: Record<TurnSurface, string> = { window: "the ATOM window", api: "the phone or the Local API" };

/** The error a refused turn throws; the Local API answers it with a 409. */
export class ChatBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatBusy";
  }
}

export interface ChatTurns {
  busy?(chat: string): boolean;
  /** Starts a turn in `chat`. Returns a line for the user when another turn is running there (and starts nothing), else undefined. */
  begin(chat: string, who: TurnSurface): string | undefined;
  /** Ends the turn `begin` started. */
  end(chat: string, who: TurnSurface): void;
  /** The chat was deleted: a turn running in it must not save it back. */
  markDeleted(chat: string): void;
  /** Whether the chat was deleted during the turn that is running (or just ended). */
  wasDeleted(chat: string): boolean;
}

export function createChatTurns(): ChatTurns {
  const running = new Map<string, TurnSurface>();
  const deleted = new Set<string>();
  return {
    busy: (chat) => running.has(chat),
    begin(chat, who) {
      const other = running.get(chat);
      if (other) return `${WORDS[other][0]!.toUpperCase()}${WORDS[other].slice(1)} is answering in this chat. Try again in a moment.`;
      running.set(chat, who);
      deleted.delete(chat); // a new turn in a chat that was deleted starts it again
      return undefined;
    },
    end(chat, who) {
      if (running.get(chat) === who) running.delete(chat);
      // Kept until the next begin: the final save of the turn that just ended runs after this.
    },
    markDeleted(chat) {
      if (running.has(chat)) deleted.add(chat);
    },
    wasDeleted: (chat) => deleted.has(chat),
  };
}
