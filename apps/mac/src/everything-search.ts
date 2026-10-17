import { HITS_PER_GROUP, rankHits, snippetAround, type Searchable } from "./search-rank.ts";

/**
 * "Search everything" (upgrades.md C1): the places ATOM keeps things, searched locally and ranked by `search-rank.ts`.
 * Nothing goes to a model. Remembered facts and conversation notes come back only to the window that asked (ADR-058).
 * The caller logs counts, never the query or a hit.
 */

/** A result of one kind. `at` is ISO 8601 when the item has a date. The meaning of `id` depends on the group. */
export interface EverythingHit {
  id: string;
  title: string;
  snippet: string;
  at?: string;
}

export type EverythingGroup = "pages" | "facts" | "notes" | "projects" | "agents" | "skills" | "routines";
export type EverythingResults = Record<EverythingGroup, EverythingHit[]>;

export const EMPTY_RESULTS = (): EverythingResults => ({ pages: [], facts: [], notes: [], projects: [], agents: [], skills: [], routines: [] });

/** The places searched. Each is optional: a place that is off (no memory, no helpers file) gives no hits. */
export interface EverythingSources {
  /** Second brain pages by words (its own full-text search); `id` is the note id. */
  brain?(query: string): { id: number; title: string; kind: string; snippet: string }[];
  facts?(): { id: number; text: string; createdAt: string }[];
  episodes?(): { id: number; summary: string; endedAt: string }[];
  projects?(): { id: string; name: string; folderLabel: string; archived: boolean }[];
  agents?(): { id: string; name: string; role: string; available: boolean; routines: { id: number; task: string; when: string; lastAt?: string }[] }[];
  skills?(): { name: string; description: string }[];
}

const hit = (h: Searchable, snippet: string, query: string): EverythingHit => ({
  id: h.id,
  title: h.title,
  snippet: snippetAround(snippet, query),
  ...(h.at ? { at: new Date(h.at).toISOString() } : {}),
});

/** One search over all sources. Empty words give empty results. A source that throws is left out, the rest still answer. */
export function searchEverything(sources: EverythingSources, query: string, onSkip?: (group: EverythingGroup) => void): EverythingResults {
  const out = EMPTY_RESULTS();
  if (!query.trim()) return out;
  const safely = (group: EverythingGroup, work: () => void) => {
    try {
      work();
    } catch {
      onSkip?.(group);
    }
  };
  safely("pages", () => {
    // Only pages Keshab or ATOM wrote: the mirrored facts, notes, chats and projects have their own groups.
    out.pages = (sources.brain?.(query) ?? [])
      .filter((n) => n.kind === "note" || n.kind === "entity")
      .slice(0, HITS_PER_GROUP)
      .map((n) => ({ id: String(n.id), title: n.title, snippet: snippetAround(n.snippet, query) }));
  });
  safely("facts", () => {
    const items = (sources.facts?.() ?? []).map((f) => ({ id: String(f.id), title: f.text, at: f.createdAt }));
    out.facts = rankHits(items, query).map((h) => hit(h, h.title, query));
  });
  safely("notes", () => {
    const items = (sources.episodes?.() ?? []).map((e) => ({ id: String(e.id), title: e.summary, at: e.endedAt }));
    out.notes = rankHits(items, query).map((h) => hit(h, h.title, query));
  });
  safely("projects", () => {
    const items = (sources.projects?.() ?? []).filter((p) => !p.archived).map((p) => ({ id: p.id, title: p.name, body: p.folderLabel }));
    out.projects = rankHits(items, query).map((h) => hit(h, h.body ?? "", query));
  });
  const agents = sources.agents?.() ?? [];
  safely("agents", () => {
    const items = agents.filter((a) => a.available).map((a) => ({ id: a.id, title: a.name, body: a.role }));
    out.agents = rankHits(items, query).map((h) => hit(h, h.body ?? "", query));
  });
  safely("routines", () => {
    const items = agents.flatMap((a) => a.routines.map((r) => ({ id: String(r.id), title: r.task, body: `${a.name}. ${r.when}`, ...(r.lastAt ? { at: r.lastAt } : {}) })));
    out.routines = rankHits(items, query).map((h) => hit(h, h.body ?? "", query));
  });
  safely("skills", () => {
    const items = (sources.skills?.() ?? []).map((s) => ({ id: s.name, title: s.name, body: s.description }));
    out.skills = rankHits(items, query).map((h) => hit(h, h.body ?? "", query));
  });
  return out;
}

/** How many hits there are in all, for the log. */
export const countHits = (results: EverythingResults) => Object.values(results).reduce((n, group) => n + group.length, 0);
