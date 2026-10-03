import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { InputSource } from "@zeno/contracts";

// ADR-058: facts the user asks ZENO to keep, in one local SQLite file. Each memory has an owner, a scope,
// provenance and a lifecycle (SECURITY.md §17). Forgetting deletes the row.

export const MAX_MEMORY_CHARS = 300;
export const DEFAULT_MAX_MEMORIES = 500;
/** The single local user, until ZENO has identities. */
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
  close(): void;
}

export interface MemoryStoreOptions {
  /** A file path, or ":memory:" for tests. */
  path: string;
  owner?: string;
  maxMemories?: number;
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

const STOP_WORDS = new Set([
  "the", "and", "for", "you", "your", "are", "was", "what", "who", "how", "why", "when", "where", "which", "that", "this",
  "with", "from", "have", "has", "had", "can", "could", "would", "should", "will", "about", "tell", "know", "does", "did",
  "not", "but", "all", "any", "there", "their", "them", "they", "then", "than", "into", "out", "our", "ours", "its",
]);

export function openMemoryStore(options: MemoryStoreOptions): MemoryStore {
  const { path, owner = LOCAL_OWNER, maxMemories = DEFAULT_MAX_MEMORIES, now = () => new Date() } = options;
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
  `);

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

  return {
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

    close() {
      db.close();
    },
  };
}
