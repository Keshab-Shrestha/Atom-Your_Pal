import { openBrain, type Brain } from "./brain.ts";
import { openBrainSources, type BrainSources } from "./brain-sources.ts";
import { openChatContinuity, type ChatContinuityStore } from "./chat-continuity.ts";
import { openSourceAnalysis, type SourceAnalysisStore } from "./source-analysis.ts";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { InputSource } from "@atom/contracts";
import { openChats, type ChatStore } from "./chats.ts";
import { openFilePermissions, type FilePermissions } from "./file-permissions.ts";
import { openForeground, type ForegroundStore } from "./foreground.ts";
import { openChatIndex, type ChatIndex } from "./chat-index.ts";
import { openProjects, type ProjectStore } from "./projects.ts";
import { foldFact, openSuggestions, type Suggestions } from "./suggestions.ts";
import { openBriefs, type Briefs } from "./briefs.ts";
import { openRecallReceipts, type RecallReceipts } from "./recall-receipts.ts";

// ADR-058: facts the user asks ATOM to keep, in one local SQLite file. Each memory has an owner, a scope,
// provenance and a lifecycle (SECURITY.md §17). Forgetting deletes the row.

export const MAX_MEMORY_CHARS = 300;
export const DEFAULT_MAX_MEMORIES = 500;
/** The single local user, until ATOM has identities. */
export const LOCAL_OWNER = "local";

export type MemoryScope = "personal";

export interface Memory {
  id: number;
  text: string;
  owner: string;
  scope: MemoryScope;
  /** How it arrived (provenance). */
  source: InputSource;
  requestId?: string;
  createdAt: Date;
  /** After this moment the fact is no longer recalled (a trip, a deadline). Absent: it never expires. */
  expiresAt?: Date;
}

/** One reversible change to the kept facts. Holds ids only, never fact text, so Forget stays final. */
export interface MemoryChange {
  id: number;
  at: Date;
  /** "supersede": a newer fact replaced one. "fold": two facts differed only in case, spacing or a final full stop. */
  action: "supersede" | "fold";
  /** The fact that was hidden. */
  memoryId: number;
  /** The fact that now stands in its place. */
  replacedBy: number;
  undone: boolean;
}

/** A short summary of one past conversation (ADR-059), so a new conversation can pick up where the last left off. */
export interface Episode {
  id: number;
  /** The Core session it summarises; one episode per session, updated as the conversation goes on. */
  sessionId: string;
  summary: string;
  /** User+assistant exchanges summarised. */
  exchanges: number;
  endedAt: Date;
}

export const MAX_EPISODE_CHARS = 400;
export const DEFAULT_MAX_EPISODES = 50;

export interface Provenance {
  source: InputSource;
  requestId?: string;
}

export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryError";
  }
}

export interface MemoryStore {
  /** Saves one fact. Returns the live memory if the same text is already kept. `until`: when the fact stops being recalled. */
  add(text: string, provenance: Provenance, options?: { until?: Date }): Memory;
  /** Memories matching the words in `query`, best first. Expired and replaced facts are left out. */
  search(query: string, limit?: number): Memory[];
  /** The newest live memories first. */
  recent(limit?: number): Memory[];
  /** Any memory by id, hidden or not, so a receipt or an undo can still find it. */
  get(id: number): Memory | undefined;
  /** Deletes a memory. Returns false if there was none with that id. */
  remove(id: number): boolean;
  /** How many live memories are kept (expired and replaced facts do not count). */
  count(): number;
  /** Replaces a live fact with a newer one. The old fact stays, hidden, until `undo`. Returns the fact that now stands. */
  supersede(id: number, text: string, provenance: Provenance, options?: { until?: Date }): Memory;
  /** Hides live facts that differ only in case, spacing or a final full stop; the newest stands. Returns how many were hidden. */
  tidy(): number;
  /** The newest changes first. */
  journal(limit?: number): MemoryChange[];
  /** Reverts the newest change that is not reverted yet. Undefined when there is none. */
  undo(): MemoryChange | undefined;
  /** Deletes every memory of this owner. Returns how many were deleted. */
  clear(): number;
  /** Saves (or updates) the summary of one conversation; the oldest beyond the limit are deleted. */
  saveEpisode(sessionId: string, summary: string, exchanges: number): Episode;
  /** The newest episodes first. */
  episodes(limit?: number): Episode[];
  removeEpisode(id: number): boolean;
  /** Deletes every episode of this owner. Returns how many were deleted. */
  clearEpisodes(): number;
  /** ADR-091: Keshab's chat sessions. */
  readonly chats: ChatStore;
  readonly chatContinuity?: ChatContinuityStore;
  readonly recallReceipts?: RecallReceipts;
  readonly foreground: ForegroundStore;
  readonly filePermissions: FilePermissions;
  /** The second brain: notes that link to each other (brain.ts). */
  readonly brain: Brain;
  readonly brainSources?: BrainSources;
  readonly sourceAnalysis?: SourceAnalysisStore;
  /** Remembering by itself (upgrades.md C2): facts the notes noticed, waiting for the user's Accept. */
  readonly suggestions: Suggestions;
  /** Daily brief (upgrades.md C3): the briefs and their settings. */
  readonly briefs: Briefs;
  /** ADR-097: the chats Keshab keeps in memory, at three depths, with hybrid search. */
  readonly chatIndex: ChatIndex;
  /** ADR-107: projects (a named folder and its chats). */
  readonly projects: ProjectStore;
  close(): void;
}

export interface MemoryStoreOptions {
  /** A file path, or ":memory:" for tests. */
  path: string;
  owner?: string;
  maxMemories?: number;
  maxEpisodes?: number;
  now?: () => Date;
}

interface Row {
  id: number;
  text: string;
  owner: string;
  scope: string;
  source: string;
  request_id: string | null;
  created_at: string;
  expires_at: string | null;
  superseded_by: number | null;
}

interface ChangeRow {
  id: number;
  at: string;
  action: string;
  memory_id: number;
  replaced_by: number;
  created_new: number;
  undone_at: string | null;
}

const toChange = (row: ChangeRow): MemoryChange => ({
  id: row.id,
  at: new Date(row.at),
  action: row.action as MemoryChange["action"],
  memoryId: row.memory_id,
  replacedBy: row.replaced_by,
  undone: row.undone_at !== null,
});

interface EpisodeRow {
  id: number;
  session_id: string;
  summary: string;
  exchanges: number;
  ended_at: string;
}

const toEpisode = (row: EpisodeRow): Episode => ({
  id: row.id,
  sessionId: row.session_id,
  summary: row.summary,
  exchanges: row.exchanges,
  endedAt: new Date(row.ended_at),
});

const toMemory = (row: Row): Memory => ({
  id: row.id,
  text: row.text,
  owner: row.owner,
  scope: row.scope as MemoryScope,
  source: row.source as InputSource,
  ...(row.request_id ? { requestId: row.request_id } : {}),
  createdAt: new Date(row.created_at),
  ...(row.expires_at ? { expiresAt: new Date(row.expires_at) } : {}),
});

/** A fact is live while nothing replaced it and its expiry, if any, is still ahead. Same rule as the SQL below. */
const LIVE = "superseded_by IS NULL AND (expires_at IS NULL OR expires_at > ?)";
const LIVE_JOINED = "m.superseded_by IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?)";

/** Cleans a fact for storage: one line, trimmed, inner whitespace collapsed. */
export function normalizeMemoryText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Turns free words into a safe FTS5 query: each word quoted, joined with OR, so punctuation or FTS syntax in
 * what the user said can never break or change the query. Very short words are left out.
 */
export function ftsQuery(text: string): string | undefined {
  const words = text
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (!words?.length) return undefined;
  return [...new Set(words)].slice(0, 24).map((w) => `"${w}"`).join(" OR ");
}

export const STOP_WORDS = new Set([
  "the", "and", "for", "you", "your", "are", "was", "what", "who", "how", "why", "when", "where", "which", "that", "this",
  "with", "from", "have", "has", "had", "can", "could", "would", "should", "will", "about", "tell", "know", "does", "did",
  "not", "but", "all", "any", "there", "their", "them", "they", "then", "than", "into", "out", "our", "ours", "its",
]);

export function openMemoryStore(options: MemoryStoreOptions): MemoryStore {
  const { path, owner = LOCAL_OWNER, maxMemories = DEFAULT_MAX_MEMORIES, maxEpisodes = DEFAULT_MAX_EPISODES, now = () => new Date() } = options;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      owner TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'personal',
      source TEXT NOT NULL,
      request_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memories_owner ON memories(owner, id);
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, content='memories', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      exchanges INTEGER NOT NULL,
      ended_at TEXT NOT NULL,
      UNIQUE (owner, session_id)
    );
    CREATE TABLE IF NOT EXISTS memory_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      at TEXT NOT NULL,
      action TEXT NOT NULL,
      memory_id INTEGER NOT NULL,
      replaced_by INTEGER NOT NULL,
      created_new INTEGER NOT NULL DEFAULT 0,
      undone_at TEXT
    );
  `);
  // Additive migration: a database made before expiry and replacement existed gets the two columns.
  const columns = new Set((db.prepare("PRAGMA table_info(memories)").all() as unknown as { name: string }[]).map((column) => column.name));
  if (!columns.has("expires_at")) db.exec("ALTER TABLE memories ADD COLUMN expires_at TEXT");
  if (!columns.has("superseded_by")) db.exec("ALTER TABLE memories ADD COLUMN superseded_by INTEGER");
  const upsertEpisode = db.prepare(`
    INSERT INTO episodes (owner, session_id, summary, exchanges, ended_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (owner, session_id) DO UPDATE SET summary = excluded.summary, exchanges = excluded.exchanges, ended_at = excluded.ended_at
  `);
  const episodeBySession = db.prepare("SELECT * FROM episodes WHERE owner = ? AND session_id = ?");
  const newestEpisodes = db.prepare("SELECT * FROM episodes WHERE owner = ? ORDER BY ended_at DESC, id DESC LIMIT ?");
  const pruneEpisodes = db.prepare(
    "DELETE FROM episodes WHERE owner = ? AND id NOT IN (SELECT id FROM episodes WHERE owner = ? ORDER BY ended_at DESC, id DESC LIMIT ?)",
  );
  const deleteEpisode = db.prepare("DELETE FROM episodes WHERE owner = ? AND id = ?");
  const clearAllEpisodes = db.prepare("DELETE FROM episodes WHERE owner = ?");

  const insert = db.prepare("INSERT INTO memories (text, owner, scope, source, request_id, created_at, expires_at) VALUES (?, ?, 'personal', ?, ?, ?, ?)");
  const byText = db.prepare(`SELECT * FROM memories WHERE owner = ? AND lower(text) = lower(?) AND ${LIVE}`);
  const byId = db.prepare("SELECT * FROM memories WHERE owner = ? AND id = ?");
  const newest = db.prepare(`SELECT * FROM memories WHERE owner = ? AND ${LIVE} ORDER BY id DESC LIMIT ?`);
  const liveOldestFirst = db.prepare(`SELECT * FROM memories WHERE owner = ? AND ${LIVE} ORDER BY id`);
  const counter = db.prepare(`SELECT count(*) AS n FROM memories WHERE owner = ? AND ${LIVE}`);
  const deleter = db.prepare("DELETE FROM memories WHERE owner = ? AND id = ?");
  const clearer = db.prepare("DELETE FROM memories WHERE owner = ?");
  const matcher = db.prepare(
    `SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid WHERE memories_fts MATCH ? AND m.owner = ? AND ${LIVE_JOINED} ORDER BY bm25(memories_fts), m.id DESC LIMIT ?`,
  );
  const hide = db.prepare("UPDATE memories SET superseded_by = ? WHERE owner = ? AND id = ?");
  const unhide = db.prepare("UPDATE memories SET superseded_by = NULL WHERE owner = ? AND id = ?");
  const recordChange = db.prepare("INSERT INTO memory_journal (owner, at, action, memory_id, replaced_by, created_new) VALUES (?, ?, ?, ?, ?, ?)");
  const newestChanges = db.prepare("SELECT * FROM memory_journal WHERE owner = ? ORDER BY id DESC LIMIT ?");
  const newestOpenChange = db.prepare("SELECT * FROM memory_journal WHERE owner = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1");
  const markUndone = db.prepare("UPDATE memory_journal SET undone_at = ? WHERE id = ?");

  const nowIso = () => now().toISOString();
  const count = () => Number((counter.get(owner, nowIso()) as { n: number }).n);
  const isLive = (row: Row) => row.superseded_by === null && (row.expires_at === null || row.expires_at > nowIso());

  const atomically = <T>(work: () => T): T => {
    db.exec("BEGIN");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  /** Keeps a fact unless the same live text is already kept. `room`: slots about to be freed, so a replacement fits at the limit. */
  const keep = (raw: string, provenance: Provenance, until: Date | undefined, room = 0): { memory: Memory; created: boolean } => {
    const text = normalizeMemoryText(raw);
    if (!text) throw new MemoryError("There is nothing to remember.");
    if (until && !(until.getTime() > now().getTime())) throw new MemoryError("That date is not in the future.");
    const existing = byText.get(owner, text, nowIso()) as Row | undefined;
    if (existing) return { memory: toMemory(existing), created: false };
    if (count() - room >= maxMemories) {
      throw new MemoryError(`Memory is full (${maxMemories} kept). Ask the user to forget some first.`);
    }
    const result = insert.run(text, owner, provenance.source, provenance.requestId ?? null, nowIso(), until ? until.toISOString() : null);
    return { memory: toMemory(byId.get(owner, Number(result.lastInsertRowid)) as unknown as Row), created: true };
  };

  const filePermissions = openFilePermissions(db);
  const foreground = openForeground(db, now);
  const chats = openChats(db, now, (id) => { filePermissions.forChat(id).revokeAll(); foreground.forgetChat(id); });
  const chatContinuity = openChatContinuity(db);
  const recallReceipts = openRecallReceipts(db, owner, now);
  const chatIndex = openChatIndex(db, now);
  const projects = openProjects(db, now);
  const brain = openBrain(db, now);
  const brainSources = openBrainSources(db, brain, now);
  const sourceAnalysis = openSourceAnalysis(db, brain, brainSources);

  let suggestionStore: Suggestions | undefined;
  const briefs = openBriefs(db, now);
  return {
    chats,
    chatContinuity,
    recallReceipts,
    foreground,
    filePermissions,
    brain,
    brainSources,
    sourceAnalysis,
    briefs,
    get suggestions() {
      return (suggestionStore ??= openSuggestions(db, this, now));
    },
    projects,
    chatIndex,
    add(raw, provenance, options) {
      return keep(raw, provenance, options?.until).memory;
    },

    search(query, limit = 8) {
      const q = ftsQuery(query);
      if (!q) return [];
      return (matcher.all(q, owner, nowIso(), limit) as unknown as Row[]).map(toMemory);
    },

    recent(limit = 8) {
      return (newest.all(owner, nowIso(), limit) as unknown as Row[]).map(toMemory);
    },

    supersede(id, raw, provenance, options) {
      return atomically(() => {
        const old = byId.get(owner, id) as Row | undefined;
        if (!old || !isLive(old)) throw new MemoryError(`Memory ${id} is not kept.`);
        const { memory, created } = keep(raw, provenance, options?.until, 1);
        if (memory.id === id) throw new MemoryError("That is the same fact, so there is nothing to replace.");
        hide.run(memory.id, owner, id);
        recordChange.run(owner, nowIso(), "supersede", id, memory.id, created ? 1 : 0);
        return memory;
      });
    },

    tidy() {
      return atomically(() => {
        const standing = new Map<string, Row>();
        let hidden = 0;
        // Oldest first: a later duplicate replaces the earlier one, so the newest stands.
        for (const row of liveOldestFirst.all(owner, nowIso()) as unknown as Row[]) {
          const key = foldFact(row.text);
          const earlier = standing.get(key);
          if (earlier) {
            hide.run(row.id, owner, earlier.id);
            recordChange.run(owner, nowIso(), "fold", earlier.id, row.id, 0);
            hidden++;
          }
          standing.set(key, row);
        }
        return hidden;
      });
    },

    journal(limit = 10) {
      return (newestChanges.all(owner, limit) as unknown as ChangeRow[]).map(toChange);
    },

    undo() {
      const entry = newestOpenChange.get(owner) as ChangeRow | undefined;
      if (!entry) return undefined;
      const at = nowIso();
      atomically(() => {
        unhide.run(owner, entry.memory_id);
        if (entry.created_new) deleter.run(owner, entry.replaced_by);
        markUndone.run(at, entry.id);
      });
      return toChange({ ...entry, undone_at: at });
    },

    get(id) {
      const row = byId.get(owner, id) as Row | undefined;
      return row ? toMemory(row) : undefined;
    },

    remove(id) {
      return Number(deleter.run(owner, id).changes) > 0;
    },

    count,

    clear() {
      return Number(clearer.run(owner).changes);
    },

    saveEpisode(sessionId, raw, exchanges) {
      const summary = normalizeMemoryText(raw).slice(0, MAX_EPISODE_CHARS);
      if (!summary) throw new MemoryError("An empty summary is not kept.");
      upsertEpisode.run(owner, sessionId, summary, exchanges, now().toISOString());
      pruneEpisodes.run(owner, owner, maxEpisodes);
      return toEpisode(episodeBySession.get(owner, sessionId) as unknown as EpisodeRow);
    },

    episodes(limit = 10) {
      return (newestEpisodes.all(owner, limit) as unknown as EpisodeRow[]).map(toEpisode);
    },

    removeEpisode(id) {
      return Number(deleteEpisode.run(owner, id).changes) > 0;
    },

    clearEpisodes() {
      return Number(clearAllEpisodes.run(owner).changes);
    },

    close() {
      db.close();
    },
  };
}
