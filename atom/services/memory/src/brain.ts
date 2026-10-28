import type { DatabaseSync } from "node:sqlite";

/**
 * The second brain: notes that link to each other, as in Obsidian. A note has a title, a Markdown body, a kind and
 * tags. `[[Title]]` in a body links to another note (a title nobody wrote yet makes a ghost note, drawn dim), and
 * `#tag` tags it. The graph is the notes and their links. Notes come from three places: Keshab and the agent write
 * them (`save`), ATOM's memory is mirrored into them (`sync`: facts, conversation notes, projects, kept chats), and
 * ATOM links what it can find by itself (`autolink`: a note that names another note's title, or a name that two notes
 * share). Note text is the user's own: never logged.
 */

export const MAX_TITLE_CHARS = 80;
export const MAX_BODY_CHARS = 20_000;
/** The graph sends at most this many notes (the most linked and newest first). */
export const MAX_GRAPH_NODES = 400;
const MAX_LINKS_PER_NOTE = 60;
const MAX_TAGS_PER_NOTE = 20;

export type NoteKind = "note" | "memory" | "episode" | "chat" | "project" | "entity";
const KINDS: readonly string[] = ["note", "memory", "episode", "chat", "project", "entity"];

export class BrainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainError";
  }
}

export interface BrainNote {
  id: number;
  title: string;
  body: string;
  kind: NoteKind;
  /** Where a mirrored note comes from ("memory:12"); absent for a note someone wrote. */
  ref?: string;
  /** Only linked to, never written: it has no body yet. */
  ghost: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BrainNode {
  id: number;
  title: string;
  kind: NoteKind;
  ghost: boolean;
  tags: string[];
  /** Links in and out. */
  degree: number;
  updatedAt: Date;
}

export interface BrainEdge {
  a: number;
  b: number;
  /** Found by ATOM, not written in a note. */
  auto: boolean;
}

export interface BrainGraph {
  nodes: BrainNode[];
  edges: BrainEdge[];
  /** Notes the graph left out because of MAX_GRAPH_NODES. */
  omitted: number;
}

export interface BrainHit {
  id: number;
  title: string;
  kind: NoteKind;
  snippet: string;
}

/** A note to mirror from ATOM's memory. */
export interface BrainSource {
  ref: string;
  title: string;
  body: string;
  kind: NoteKind;
}

export interface Brain {
  /**
   * Creates or updates a note by title (or by `ref`; or by `id`, which also renames it), reads its links and tags, and
   * makes ghosts for new link targets. Throws BrainError for a bad note, an unknown `id`, or a title another note has.
   */
  save(input: { id?: number; title: string; body: string; kind?: NoteKind; ref?: string; preserveWhitespace?: boolean }): BrainNote;
  get(id: number): BrainNote | undefined;
  byTitle(title: string): BrainNote | undefined;
  /** Notes that link to this one, by title. */
  backlinks(id: number): { id: number; title: string; kind: NoteKind; auto: boolean }[];
  /** Notes this one links to, by title. */
  links(id: number): { id: number; title: string; kind: NoteKind; ghost: boolean; auto: boolean }[];
  /** True when the note existed. A note others link to stays as a ghost. */
  remove(id: number): boolean;
  graph(): BrainGraph;
  search(query: string, limit?: number): BrainHit[];
  /** Tags with their note counts, most used first. */
  tags(): { tag: string; count: number }[];
  /** Makes the mirrored notes of the given `ref` prefixes equal to `items`: adds, updates and drops. */
  sync(items: readonly BrainSource[], prefixes: readonly string[]): { added: number; updated: number; removed: number };
  /** Rebuilds ATOM's own links: title mentions and shared names. Returns how many it made. */
  autolink(): number;
  count(): number;
}

const WIKILINK = /\[\[([^\[\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]/g;
const TAG = /(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]{1,39})/gu;

/** A title: one nonempty line, spaces squeezed. Throws BrainError. */
export function cleanTitle(raw: string): string {
  const title = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!title) throw new BrainError("A note needs a title.");
  return title;
}

/** The titles linked with [[…]] in a body, in order, once each (any case). */
export function linkTitles(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(WIKILINK)) {
    const title = m[1]!.replace(/\s+/g, " ").trim();
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push(title);
  }
  return out.slice(0, MAX_LINKS_PER_NOTE);
}

/** The #tags in a body, lower-case, once each. */
export function tagsOf(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(TAG)) seen.add(m[1]!.toLowerCase().replace(/[/-]+$/, ""));
  return [...seen].filter((t) => t.length >= 2).slice(0, MAX_TAGS_PER_NOTE);
}

/** Words that start a sentence or name a day or month: never a name on their own. */
const NOT_NAMES = new Set(
  "the a an and but or so if when then this that these those it its i we you he she they my our your his her their there here what which who how why monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december keshab user atom pal".split(" "),
);

/** Capitalised names in a text: one or more capitalised words, not at the start of a sentence unless two words long. */
export function namesIn(text: string): string[] {
  const out = new Set<string>();
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  for (const sentence of sentences) {
    const words = [...sentence.matchAll(/[\p{L}][\p{L}'’-]*/gu)];
    for (let i = 0; i < words.length; ) {
      const w = words[i]![0];
      if (!/^\p{Lu}\p{Ll}{2,}/u.test(w) || NOT_NAMES.has(w.toLowerCase())) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < words.length && /^\p{Lu}\p{Ll}+/u.test(words[j]![0]) && !NOT_NAMES.has(words[j]![0].toLowerCase()) && words[j]!.index === words[j - 1]!.index! + words[j - 1]![0].length + 1) j++;
      const name = words.slice(i, j).map((m) => m[0]).join(" ");
      // A single capitalised word that opens a sentence is just a sentence start.
      if (!(i === 0 && j - i === 1)) out.add(name);
      i = j;
    }
  }
  return [...out];
}

const snippetOf = (body: string, query: string) => {
  const flat = body.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(query.toLowerCase().split(/\s+/)[0] ?? "");
  const start = Math.max(0, at - 40);
  const part = flat.slice(start, start + 140);
  return `${start > 0 ? "…" : ""}${part}${start + 140 < flat.length ? "…" : ""}`;
};

/** An FTS5 query from the user's words: each word quoted, matched as a prefix. */
function ftsQuery(query: string): string | undefined {
  const words = (query.match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 8);
  return words.length ? words.map((w) => `"${w}"*`).join(" ") : undefined;
}

export function openBrain(db: DatabaseSync, now: () => Date): Brain {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL COLLATE NOCASE UNIQUE,
      body TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'note',
      ref TEXT,
      ghost INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS brain_notes_ref ON brain_notes(ref) WHERE ref IS NOT NULL;
    CREATE TABLE IF NOT EXISTS brain_links (
      src INTEGER NOT NULL,
      dst INTEGER NOT NULL,
      auto INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (src, dst, auto)
    );
    CREATE INDEX IF NOT EXISTS brain_links_dst ON brain_links(dst);
    CREATE TABLE IF NOT EXISTS brain_tags (
      note INTEGER NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (note, tag)
    );
    CREATE INDEX IF NOT EXISTS brain_tags_tag ON brain_tags(tag);
    CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(title, body, content='brain_notes', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS brain_ai AFTER INSERT ON brain_notes BEGIN
      INSERT INTO brain_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS brain_ad AFTER DELETE ON brain_notes BEGIN
      INSERT INTO brain_fts(brain_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS brain_au AFTER UPDATE ON brain_notes BEGIN
      INSERT INTO brain_fts(brain_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
      INSERT INTO brain_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END;
  `);

  type Row = { id: number; title: string; body: string; kind: string; ref: string | null; ghost: number; created_at: string; updated_at: string };
  const byId = db.prepare("SELECT * FROM brain_notes WHERE id = ?");
  const byTitleQ = db.prepare("SELECT * FROM brain_notes WHERE title = ?");
  const byRef = db.prepare("SELECT * FROM brain_notes WHERE ref = ?");
  const insertNote = db.prepare("INSERT INTO brain_notes (title, body, kind, ref, ghost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const updateNote = db.prepare("UPDATE brain_notes SET title = ?, body = ?, kind = ?, ref = ?, ghost = 0, updated_at = ? WHERE id = ?");
  const deleteNote = db.prepare("DELETE FROM brain_notes WHERE id = ?");
  const makeGhost = db.prepare("UPDATE brain_notes SET body = '', ghost = 1, ref = NULL, kind = 'note', updated_at = ? WHERE id = ?");
  const tagsOfNote = db.prepare("SELECT tag FROM brain_tags WHERE note = ? ORDER BY tag");
  const dropTags = db.prepare("DELETE FROM brain_tags WHERE note = ?");
  const addTag = db.prepare("INSERT OR IGNORE INTO brain_tags (note, tag) VALUES (?, ?)");
  const dropLinks = db.prepare("DELETE FROM brain_links WHERE src = ? AND auto = ?");
  const dropAllLinksOf = db.prepare("DELETE FROM brain_links WHERE src = ?");
  const dropAutoLinks = db.prepare("DELETE FROM brain_links WHERE auto = 1");
  const addLink = db.prepare("INSERT OR IGNORE INTO brain_links (src, dst, auto) VALUES (?, ?, ?)");
  const backlinksQ = db.prepare(
    "SELECT n.id, n.title, n.kind, MIN(l.auto) AS auto FROM brain_links l JOIN brain_notes n ON n.id = l.src WHERE l.dst = ? GROUP BY n.id ORDER BY n.title",
  );
  const linksQ = db.prepare(
    "SELECT n.id, n.title, n.kind, n.ghost, MIN(l.auto) AS auto FROM brain_links l JOIN brain_notes n ON n.id = l.dst WHERE l.src = ? GROUP BY n.id ORDER BY n.title",
  );
  const backlinkCount = db.prepare("SELECT count(*) AS n FROM brain_links WHERE dst = ? AND src != dst");
  const allNotes = db.prepare("SELECT * FROM brain_notes");
  const allEdges = db.prepare("SELECT src, dst, MIN(auto) AS auto FROM brain_links WHERE src != dst GROUP BY src, dst");
  const allTags = db.prepare("SELECT note, tag FROM brain_tags ORDER BY tag");
  const tagCounts = db.prepare("SELECT tag, count(*) AS n FROM brain_tags GROUP BY tag ORDER BY n DESC, tag LIMIT 100");
  const ftsQ = db.prepare(
    "SELECT n.id, n.title, n.kind, n.body FROM brain_fts f JOIN brain_notes n ON n.id = f.rowid WHERE brain_fts MATCH ? AND n.ghost = 0 ORDER BY bm25(brain_fts) LIMIT ?",
  );
  const refsWithPrefix = db.prepare("SELECT id, ref FROM brain_notes WHERE ref LIKE ? ESCAPE '\\'");
  const countQ = db.prepare("SELECT count(*) AS n FROM brain_notes WHERE ghost = 0");

  const toNote = (row: Row): BrainNote => ({
    id: row.id,
    title: row.title,
    body: row.body,
    kind: (KINDS.includes(row.kind) ? row.kind : "note") as NoteKind,
    ...(row.ref ? { ref: row.ref } : {}),
    ghost: row.ghost === 1,
    tags: (tagsOfNote.all(row.id) as { tag: string }[]).map((t) => t.tag),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
  const transaction = <T>(work: () => T): T => {
    db.exec("SAVEPOINT brain_edit");
    try {
      const out = work();
      db.exec("RELEASE brain_edit");
      return out;
    } catch (error) {
      db.exec("ROLLBACK TO brain_edit; RELEASE brain_edit");
      throw error;
    }
  };

  /** The id of the note with this title, made as a ghost when nobody wrote it yet. */
  function idForLink(title: string): number {
    const found = byTitleQ.get(title) as Row | undefined;
    if (found) return found.id;
    return Number(insertNote.run(title, "", "note", null, 1, now().toISOString(), now().toISOString()).lastInsertRowid);
  }

  /** Ghost notes nothing links to any more are dropped. */
  function pruneGhosts() {
    db.exec("DELETE FROM brain_notes WHERE ghost = 1 AND id NOT IN (SELECT dst FROM brain_links)");
  }

  function save(input: { id?: number; title: string; body: string; kind?: NoteKind; ref?: string; preserveWhitespace?: boolean }): BrainNote {
    const title = cleanTitle(input.title);
    const body = typeof input.body === "string" ? (input.preserveWhitespace ? input.body : input.body.replace(/\r\n/g, "\n").trim()) : "";
    const kind: NoteKind = input.kind && KINDS.includes(input.kind) ? input.kind : "note";
    return transaction(() => {
      const stamp = now().toISOString();
      let existing: Row | undefined;
      if (input.id !== undefined) {
        existing = byId.get(input.id) as Row | undefined;
        if (!existing) throw new BrainError("That note is gone.");
        const clash = byTitleQ.get(title) as Row | undefined;
        if (clash && clash.id !== existing.id) {
          if (clash.ghost === 0) throw new BrainError(`Another note is called "${clash.title}".`);
          // Renaming into a ghost's title: the links to the ghost now point here.
          db.prepare("UPDATE OR IGNORE brain_links SET dst = ? WHERE dst = ?").run(existing.id, clash.id);
          db.prepare("DELETE FROM brain_links WHERE dst = ?").run(clash.id);
          deleteNote.run(clash.id);
        }
      } else {
        existing = (input.ref ? (byRef.get(input.ref) as Row | undefined) : undefined) ?? (byTitleQ.get(title) as Row | undefined);
      }
      let id: number;
      if (existing) {
        id = existing.id;
        // A mirrored note keeps its source; a written note keeps its kind unless one is given.
        updateNote.run(title, body, input.kind ? kind : (existing.kind as NoteKind), input.ref ?? existing.ref, stamp, id);
      } else {
        id = Number(insertNote.run(title, body, kind, input.ref ?? null, 0, stamp, stamp).lastInsertRowid);
      }
      dropLinks.run(id, 0);
      for (const target of linkTitles(body)) {
        const dst = idForLink(target);
        if (dst !== id) addLink.run(id, dst, 0);
      }
      dropTags.run(id);
      for (const tag of tagsOf(body)) addTag.run(id, tag);
      pruneGhosts();
      return toNote(byId.get(id) as unknown as Row);
    });
  }

  function remove(id: number): boolean {
    const row = byId.get(id) as Row | undefined;
    if (!row) return false;
    transaction(() => {
      dropAllLinksOf.run(id);
      dropTags.run(id);
      if (Number((backlinkCount.get(id) as { n: number }).n) > 0) makeGhost.run(now().toISOString(), id);
      else deleteNote.run(id);
      pruneGhosts();
    });
    return true;
  }

  function graph(): BrainGraph {
    const rows = allNotes.all() as unknown as Row[];
    const edgesAll = (allEdges.all() as { src: number; dst: number; auto: number }[]).map((e) => ({ a: e.src, b: e.dst, auto: e.auto === 1 }));
    const degree = new Map<number, number>();
    for (const e of edgesAll) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    const tags = new Map<number, string[]>();
    for (const t of allTags.all() as { note: number; tag: string }[]) tags.set(t.note, [...(tags.get(t.note) ?? []), t.tag]);
    const ranked = rows
      .map((r) => ({ row: r, degree: degree.get(r.id) ?? 0 }))
      .sort((x, y) => y.degree - x.degree || y.row.updated_at.localeCompare(x.row.updated_at) || x.row.id - y.row.id);
    const kept = ranked.slice(0, MAX_GRAPH_NODES);
    const ids = new Set(kept.map((k) => k.row.id));
    return {
      nodes: kept.map(({ row, degree: d }) => ({
        id: row.id,
        title: row.title,
        kind: (KINDS.includes(row.kind) ? row.kind : "note") as NoteKind,
        ghost: row.ghost === 1,
        tags: tags.get(row.id) ?? [],
        degree: d,
        updatedAt: new Date(row.updated_at),
      })),
      edges: edgesAll.filter((e) => ids.has(e.a) && ids.has(e.b)),
      omitted: Math.max(0, rows.length - kept.length),
    };
  }

  function sync(items: readonly BrainSource[], prefixes: readonly string[]) {
    let added = 0;
    let updated = 0;
    let removed = 0;
    transaction(() => {
      const wanted = new Set(items.map((i) => i.ref));
      const taken = new Set<string>();
      for (const item of items) {
        const body = item.body.slice(0, MAX_BODY_CHARS);
        const existing = byRef.get(item.ref) as Row | undefined;
        if (existing && existing.body === body && existing.kind === item.kind) {
          taken.add(existing.title.toLowerCase());
          continue;
        }
        // Titles are unique: a second note with the same title gets " (2)".
        let title = cleanTitle(item.title).slice(0, MAX_TITLE_CHARS - 4);
        for (let n = 2; ; n++) {
          const clash = byTitleQ.get(title) as Row | undefined;
          // A ghost's title is free only for a NEW note, which takes the ghost's place (below). A note that already exists keeps its own row,
          // so it must not take a title the ghost holds: that broke the unique-title rule and rolled back the whole sync (review, 2026-10-16).
          if ((!clash || clash.id === existing?.id || (clash.ghost === 1 && !existing)) && !taken.has(title.toLowerCase())) break;
          title = `${cleanTitle(item.title).slice(0, MAX_TITLE_CHARS - 6)} (${n})`;
        }
        taken.add(title.toLowerCase());
        const clash = byTitleQ.get(title) as Row | undefined;
        // A ghost with this title becomes this note, so the links to it stay.
        if (!existing && clash?.ghost === 1) {
          updateNote.run(title, body, item.kind, item.ref, now().toISOString(), clash.id);
          added++;
          continue;
        }
        if (existing) {
          updateNote.run(title, body, item.kind, item.ref, now().toISOString(), existing.id);
          updated++;
        } else {
          insertNote.run(title, body, item.kind, item.ref, 0, now().toISOString(), now().toISOString());
          added++;
        }
      }
      for (const prefix of prefixes) {
        for (const row of refsWithPrefix.all(`${prefix.replace(/[\\%_]/g, "\\$&")}%`) as { id: number; ref: string }[]) {
          if (wanted.has(row.ref)) continue;
          dropAllLinksOf.run(row.id);
          dropTags.run(row.id);
          if (Number((backlinkCount.get(row.id) as { n: number }).n) > 0) makeGhost.run(now().toISOString(), row.id);
          else deleteNote.run(row.id);
          removed++;
        }
      }
      // A mirrored note's own [[links]] and #tags count, as in a written one.
      for (const item of items) {
        const row = byRef.get(item.ref) as Row | undefined;
        if (!row) continue;
        dropLinks.run(row.id, 0);
        for (const target of linkTitles(row.body)) {
          const dst = idForLink(target);
          if (dst !== row.id) addLink.run(row.id, dst, 0);
        }
        dropTags.run(row.id);
        for (const tag of tagsOf(row.body)) addTag.run(row.id, tag);
      }
      pruneGhosts();
    });
    return { added, updated, removed };
  }

  function autolink(): number {
    let made = 0;
    transaction(() => {
      dropAutoLinks.run();
      const notes = (allNotes.all() as unknown as Row[]).filter((r) => r.ghost === 0);
      // 1. A note whose text names another note's title (3 or more letters) links to it.
      const titled = notes.filter((n) => [...n.title].length >= 3 && n.kind !== "memory" && n.kind !== "episode" && n.kind !== "entity");
      for (const note of notes) {
        const text = note.body.toLowerCase();
        for (const other of titled) {
          if (other.id === note.id) continue;
          const t = other.title.toLowerCase();
          const at = text.indexOf(t);
          if (at < 0) continue;
          const before = text[at - 1];
          const after = text[at + t.length];
          if ((before && /[\p{L}\p{N}]/u.test(before)) || (after && /[\p{L}\p{N}]/u.test(after))) continue; // inside a longer word
          addLink.run(note.id, other.id, 1);
          made++;
        }
      }
      // 2. A name that two or more notes share becomes an entity note they all link to.
      const holders = new Map<string, number[]>();
      for (const note of notes) {
        if (note.kind === "entity") continue; // an entity is made from the names, never a holder of one
        for (const name of namesIn(`${note.title}. ${note.body}`)) {
          const key = name.toLowerCase();
          holders.set(key, [...(holders.get(key) ?? []), note.id]);
        }
      }
      const display = new Map<string, string>();
      for (const note of notes) if (note.kind !== "entity") for (const name of namesIn(`${note.title}. ${note.body}`)) display.set(name.toLowerCase(), name);
      for (const [key, ids] of holders) {
        const unique = [...new Set(ids)];
        if (unique.length < 2) continue;
        const name = display.get(key)!;
        if ([...name].length > MAX_TITLE_CHARS) continue;
        const existing = byTitleQ.get(name) as Row | undefined;
        if (existing && existing.ghost === 0 && existing.kind !== "entity" && !unique.includes(existing.id)) {
          // A note written under this name already exists: link to it.
          for (const id of unique) {
            addLink.run(id, existing.id, 1);
            made++;
          }
          continue;
        }
        const entity = existing && existing.ghost === 0 ? existing.id : existing ? (updateNote.run(name, "", "entity", null, now().toISOString(), existing.id), existing.id) : Number(insertNote.run(name, "", "entity", null, 0, now().toISOString(), now().toISOString()).lastInsertRowid);
        for (const id of unique) {
          if (id === entity) continue;
          addLink.run(id, entity, 1);
          made++;
        }
      }
      // Entity notes nothing links to any more are dropped.
      db.exec("DELETE FROM brain_notes WHERE kind = 'entity' AND body = '' AND id NOT IN (SELECT dst FROM brain_links)");
      pruneGhosts();
    });
    return made;
  }

  return {
    save,
    get: (id) => {
      const row = byId.get(id) as Row | undefined;
      return row && toNote(row);
    },
    byTitle: (title) => {
      const row = byTitleQ.get(title.replace(/\s+/g, " ").trim()) as Row | undefined;
      return row && toNote(row);
    },
    backlinks: (id) => (backlinksQ.all(id) as { id: number; title: string; kind: string; auto: number }[]).map((r) => ({ id: r.id, title: r.title, kind: r.kind as NoteKind, auto: r.auto === 1 })),
    links: (id) => (linksQ.all(id) as { id: number; title: string; kind: string; ghost: number; auto: number }[]).map((r) => ({ id: r.id, title: r.title, kind: r.kind as NoteKind, ghost: r.ghost === 1, auto: r.auto === 1 })),
    remove,
    graph,
    search(query, limit = 8) {
      const q = ftsQuery(query);
      if (!q) return [];
      return (ftsQ.all(q, Math.max(1, Math.min(limit, 50))) as { id: number; title: string; kind: string; body: string }[]).map((r) => ({ id: r.id, title: r.title, kind: r.kind as NoteKind, snippet: snippetOf(r.body, query) }));
    },
    tags: () => (tagCounts.all() as { tag: string; n: number }[]).map((t) => ({ tag: t.tag, count: Number(t.n) })),
    sync,
    autolink,
    count: () => Number((countQ.get() as { n: number }).n),
  };
}
