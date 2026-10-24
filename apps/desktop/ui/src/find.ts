// Find in chat (ADR-152): a literal, case-insensitive search of the messages already loaded, independent of the archived and
// global search. A port of ChatFind.swift. It searches the source text of each message, as ATOM wrote it.

export interface FindMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
}

export interface FindMatch {
  messageId: number;
  user: boolean;
  /** Where the match starts in the message's text, in UTF-16 units. */
  offset: number;
  before: string;
  found: string;
  after: string;
}

export interface FindResults {
  matches: FindMatch[];
  /** The search stopped at the limit; there are more. */
  more: boolean;
}

export const MAX_MATCHES = 500;
const BEFORE = 40;
const AFTER = 60;

const NONE: FindResults = { matches: [], more: false };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** A slice of context that never starts or ends in the middle of a surrogate pair. */
function context(text: string, from: number, to: number): string {
  let start = from;
  let end = to;
  if (start > 0 && start < text.length && isLow(text.charCodeAt(start))) start += 1;
  if (end > start && end < text.length && isHigh(text.charCodeAt(end - 1))) end -= 1;
  return text.slice(start, end);
}

export function findInMessages(messages: readonly FindMessage[], query: string): FindResults {
  if (query === "") return NONE;
  // `i` with `u` folds case without changing a string's length, so offsets stay true.
  const pattern = new RegExp(escape(query), "giu");
  const matches: FindMatch[] = [];
  for (const message of messages) {
    pattern.lastIndex = 0;
    for (let hit = pattern.exec(message.text); hit; hit = pattern.exec(message.text)) {
      if (matches.length >= MAX_MATCHES) return { matches, more: true };
      const end = hit.index + hit[0].length;
      matches.push({
        messageId: message.id,
        user: message.role === "user",
        offset: hit.index,
        before: context(message.text, Math.max(0, hit.index - BEFORE), hit.index),
        found: hit[0],
        after: context(message.text, end, end + AFTER),
      });
    }
  }
  return { matches, more: false };
}

/** The selected match; a selection past the end is the last one. */
export function selectedMatch(results: FindResults, index: number): FindMatch | undefined {
  return results.matches.length === 0 ? undefined : results.matches[Math.min(Math.max(0, index), results.matches.length - 1)];
}

/** The next selection, wrapping at both ends. */
export function stepSelection(index: number, count: number, direction: 1 | -1): number {
  if (count === 0) return 0;
  return (Math.min(index, count - 1) + direction + count) % count;
}

/** "3 of 12", "3 of 500+" or "0 matches". */
export function countLabel(results: FindResults, index: number): string {
  const n = results.matches.length;
  if (n === 0) return "0 matches";
  return `${Math.min(index, n - 1) + 1} of ${n}${results.more ? "+" : ""}`;
}
