// Saved history and "What this chat remembers" (ADR-091): read-only pages of the chat's saved archive, and what the runtime says it keeps
// for replay. Ports of the cursor and wording rules of ChatControlsModel.swift. Nothing here changes a chat.

/** Where a page starts: a saved message (1-based) and a character offset into it. A long message continues on the next page. */
export interface Cursor {
  message: number;
  offset: number;
}

export const FIRST: Cursor = { message: 1, offset: 0 };

/** The page that ends the chat: the runtime lists up to eight messages, so start seven before the end. */
export const latestCursor = (messages: number): Cursor => ({ message: Math.max(1, messages - 7), offset: 0 });

/** Why saved history cannot be read now; undefined when it can. */
export function historyWhy(chat: { messages: number } | undefined, ready: boolean): string | undefined {
  if (!ready) return "ATOM is not ready.";
  if (!chat) return "There is no saved chat yet.";
  if (chat.messages === 0) return "This chat is not saved yet. Send a message first.";
  return undefined;
}

/** "Message 3 · ATOM", and for a long message that continues from an earlier page, where this part starts. */
export function partLabel(part: { seq: number; role: string; offset: number }): string {
  const who = part.role === "user" ? "You" : "ATOM";
  return `Message ${part.seq} · ${who}${part.offset > 0 ? ` · continues from character ${part.offset}` : ""}`;
}

/** The runtime's byte counts, in kilobytes as the Mac app words them. */
export const kb = (bytes: number): string => `${(bytes / 1000).toFixed(1)} KB`;
