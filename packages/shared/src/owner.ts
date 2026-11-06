// ADR-271: the name ARK uses for its owner in its own prompts and messages. ARK ships to other people, so no name is
// written in the code. The island asks for the name on first run and sends it (`owner.set`); the runtime keeps it in
// config/owner.json and sets it here at start. Until then, prompts say "the user".

/** The longest name kept. A longer one is cut. */
export const OWNER_NAME_MAX = 60;
const FALLBACK = "the user";

let current: string | undefined;

/** A usable name from untrusted input: one line, no control characters, at most OWNER_NAME_MAX characters. Undefined if empty. */
export function cleanOwnerName(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const name = input.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, OWNER_NAME_MAX).trim();
  return name || undefined;
}

/** The owner's name for prompts and messages, or "the user" when none is set ("The user" with `sentenceStart`). */
export function ownerName(sentenceStart = false): string {
  return current ?? (sentenceStart ? "The user" : FALLBACK);
}

/** Sets the name (cleaned). An empty or invalid name clears it. Returns the name now in use. */
export function setOwnerName(input: unknown): string {
  current = cleanOwnerName(input);
  return ownerName();
}
