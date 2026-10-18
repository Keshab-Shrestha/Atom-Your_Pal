import { openBrain, type Brain } from "./brain.ts";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { InputSource } from "@atom/contracts";
import { openChats, type ChatStore } from "./chats.ts";
import { openFilePermissions, type FilePermissions } from "./file-permissions.ts";
import { openForeground, type ForegroundStore } from "./foreground.ts";
import { openChatIndex, type ChatIndex } from "./chat-index.ts";
import { openProjects, type ProjectStore } from "./projects.ts";
import { openSuggestions, type Suggestions } from "./suggestions.ts";
import { openBriefs, type Briefs } from "./briefs.ts";

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
  /** Saves one fact. Returns the existing memory if the same text is already kept. */
  add(text: string, provenance: Provenance): Memory;
  /** Memories matching the words in `query`, best first. */
  search(query: string, limit?: number): Memory[];
  /** The newest memories first. */
  recent(limit?: number): Memory[];
  get(id: number): Memory | undefined;
  /** Deletes a memory. Returns false if there was none with that id. */
  remove(id: number): boolean;
  count(): number;
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
  readonly foreground: ForegroundStore;
  readonly filePermissions: FilePermissions;
  /** The second brain: notes that link to each other (brain.ts). */
  readonly brain: Brain;
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
}

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
});

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
  `);
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

  const insert = db.prepare("INSERT INTO memories (text, owner, scope, source, request_id, created_at) VALUES (?, ?, 'personal', ?, ?, ?)");
  const byText = db.prepare("SELECT * FROM memories WHERE owner = ? AND lower(text) = lower(?)");
  const byId = db.prepare("SELECT * FROM memories WHERE owner = ? AND id = ?");
  const newest = db.prepare("SELECT * FROM memories WHERE owner = ? ORDER BY id DESC LIMIT ?");
  const counter = db.prepare("SELECT count(*) AS n FROM memories WHERE owner = ?");
  const deleter = db.prepare("DELETE FROM memories WHERE owner = ? AND id = ?");
  const clearer = db.prepare("DELETE FROM memories WHERE owner = ?");
  const matcher = db.prepare(
    "SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid WHERE memories_fts MATCH ? AND m.owner = ? ORDER BY bm25(memories_fts), m.id DESC LIMIT ?",
  );

  const count = () => Number((counter.get(owner) as { n: number }).n);

  const filePermissions = openFilePermissions(db);
  const foreground = openForeground(db, now);
  const chats = openChats(db, now, (id) => { filePermissions.forChat(id).revokeAll(); foreground.forgetChat(id); });
  const chatIndex = openChatIndex(db, now);
  const projects = openProjects(db, now);
  const brain = openBrain(db, now);

  let suggestionStore: Suggestions | undefined;
  const briefs = openBriefs(db, now);
  return {
    chats,
    foreground,
    filePermissions,
    brain,
    briefs,
    get suggestions() {
      return (suggestionStore ??= openSuggestions(db, this, now));
    },
    projects,
    chatIndex,
    add(raw, provenance) {
      const text = normalizeMemoryText(raw);
      if (!text) throw new MemoryError("There is nothing to remember.");
      if (text.length > MAX_MEMORY_CHARS) {
        throw new MemoryError(`That is too long to keep as one memory (${text.length} characters, limit ${MAX_MEMORY_CHARS}). Keep the key fact only.`);
      }
      const existing = byText.get(owner, text) as Row | undefined;
      if (existing) return toMemory(existing);
      if (count() >= maxMemories) {
        throw new MemoryError(`Memory is full (${maxMemories} kept). Ask the user to forget some first.`);
      }
      const result = insert.run(text, owner, provenance.source, provenance.requestId ?? null, now().toISOString());
      return toMemory(byId.get(owner, Number(result.lastInsertRowid)) as unknown as Row);
    },

    search(query, limit = 8) {
      const q = ftsQuery(query);
      if (!q) return [];
      return (matcher.all(q, owner, limit) as unknown as Row[]).map(toMemory);
    },

    recent(limit = 8) {
      return (newest.all(owner, limit) as unknown as Row[]).map(toMemory);
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
