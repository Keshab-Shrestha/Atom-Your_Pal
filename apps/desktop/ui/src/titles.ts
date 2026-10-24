/** A chat title the runtime will take: one line, 1 to 60 characters after trimming (docs/island-protocol.md, `chat.rename`). */
export const MAX_TITLE = 60;

export function checkTitle(raw: string): { ok: true; title: string } | { ok: false; why: string } {
  const title = raw.trim();
  if (title === "") return { ok: false, why: "A title needs at least one character." };
  if (/[\r\n\u2028\u2029]/.test(title)) return { ok: false, why: "A title is one line." };
  if ([...title].length > MAX_TITLE) return { ok: false, why: `A title can have at most ${MAX_TITLE} characters.` };
  return { ok: true, title };
}
