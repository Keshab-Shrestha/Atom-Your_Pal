/**
 * Ranking for the window's "search everything" (upgrades.md C1). Pure: no store, no model. A title that starts with the
 * words comes first, then a title with a word that starts with them, then a title that has them anywhere, then a body
 * that has them; a newer item wins a tie. Case and character width do not matter (NFKC, so full-width letters and
 * half-width katakana match); Japanese has no spaces between words, so a match anywhere counts as a word start there.
 */

/** At most this many hits for each kind of item. */
export const HITS_PER_GROUP = 8;

export interface Searchable {
  id: string;
  title: string;
  body?: string;
  /** ISO 8601 or a Date; items without a date tie on score and keep their order. */
  at?: string | Date;
}

/** Lower case, canonical and compatible forms joined (NFKC), spaces squeezed. */
export const fold = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

const CJK = /[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** 4: the title starts with the query; 3: a word of it does; 2: it has the query inside; 1: only the body has it; 0: no match. */
export function score(item: Searchable, query: string): number {
  const q = fold(query);
  if (!q) return 0;
  const title = fold(item.title);
  const at = title.indexOf(q);
  if (at === 0) return 4;
  if (at > 0) {
    const before = title[at - 1]!;
    // A word start: after a space or a mark, or anywhere in Japanese text, which has no spaces between words.
    if (!WORD_CHAR.test(before) || CJK.test(q[0]!)) return 3;
    return 2;
  }
  return item.body && fold(item.body).includes(q) ? 1 : 0;
}

const time = (at?: string | Date) => (at === undefined ? 0 : new Date(at).getTime() || 0);

/** The items that match, best first, at most `limit`. Stable: equal items keep their order. */
export function rankHits<T extends Searchable>(items: readonly T[], query: string, limit = HITS_PER_GROUP): T[] {
  return items
    .map((item, index) => ({ item, index, s: score(item, query) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || time(b.item.at) - time(a.item.at) || a.index - b.index)
    .slice(0, limit)
    .map((r) => r.item);
}

/** A short piece of `body` around the first match (or its start), on one line, with … where it was cut. */
export function snippetAround(body: string, query: string, width = 90): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  const q = fold(query);
  // Folding can change the length (NFKC), so find the match in the folded text only to decide where to look.
  const guess = q ? fold(flat).indexOf(q) : -1;
  const start = guess < 0 ? 0 : Math.max(0, Math.min(guess - Math.floor(width / 3), flat.length - width));
  const piece = flat.slice(start, start + width).trim();
  return `${start > 0 ? "…" : ""}${piece}${start + width < flat.length ? "…" : ""}`;
}
