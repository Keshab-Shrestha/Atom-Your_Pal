// ADR-098: the "telegram" chat and the "api" / "api-<chatId>" chats each have one writer. The ZENO window only reads them.

/** Who writes this chat, in words for the window ("Telegram", "the local API"). Undefined for a chat the window writes. */
export function chatWriter(id: string): string | undefined {
  if (id === "telegram") return "Telegram";
  if (id === "api" || id.startsWith("api-")) return "the local API";
  return undefined;
}

/** The window's refusal for a turn in a chat that another surface writes. */
export function readOnlyMessage(writer: string): string {
  return `This chat is written from ${writer}. Open it to read it only.`;
}
