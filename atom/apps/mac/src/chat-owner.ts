// ADR-098: the "telegram" chat has one writer. The ATOM window only reads it.
// ADR-110 (N3): so does a routine's chat ("routine-<id>") on the native engine.
// 2026-10-16 (ADR-121): the "api" / "api-<chatId>" chats are shared. The phone page writes them and so does the window (Keshab wanted to
// continue a phone chat on the Mac). Each side reads the saved messages again when the other has written (see `isSharedChat`).

/** The chats that the local API and the window both write. */
export const isSharedChat = (id: string): boolean => id === "api" || id.startsWith("api-");

/** Who writes this chat, in words for the window ("Telegram", "the local API"). Undefined for a chat the window writes. */
export function chatWriter(id: string): string | undefined {
  if (id === "telegram") return "Telegram";
  if (/^routine-\d+$/.test(id)) return "a routine";
  return undefined;
}

/** The window's refusal for a turn in a chat that another surface writes. */
export function readOnlyMessage(writer: string): string {
  return `This chat is written from ${writer}. Open it to read it only.`;
}
