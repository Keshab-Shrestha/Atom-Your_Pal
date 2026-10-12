import type { DatabaseSync } from "node:sqlite";
import type { Message } from "@atom/contracts";
import { chatSearch, type ChatSearchHit } from "./chat-search.ts";

// ADR-091: Keshab's chat sessions with ATOM, kept on this Mac (in the memory file) so he can go back to one. A chat is
// ATOM Core's session: its id, a title from its first words and its turns. Never logged; the newest 200 are kept.

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: Date;
  /** User and assistant turns. */
  messages: number;
}

export interface ChatStore {
  /** Saves a session's turns (after each exchange); the title comes from its first words. */
  save(id: string, turns: readonly Message[]): void;
  /** The newest first. */
  list(limit?: number): ChatSummary[];
  messages(id: string): Message[];
  remove(id: string): boolean;
  /** ADR-097: the chat's own provider and model; undefined when it uses the default. */
  model(id: string): { provider: string; model: string } | undefined;
  /** ADR-097: sets the chat's own model (undefined: the default again). False when the chat is not saved yet. */
  setModel(id: string, choice: { provider: string; model: string } | undefined): boolean;
  /** ADR-098 item 9: the chat's Claude Code session (its id, model and last answer's hash); undefined when none. */
  session(id: string): ChatSessionRef | undefined;
  /** ADR-098 item 9: sets the chat's session. False when the chat is not saved yet. */
  setSession(id: string, session: ChatSessionRef): boolean;
  /** ADR-098: chats whose messages match the words (titles are a chat's first words), best first. */
  search(query: string): ChatSearchHit[];
}

export interface ChatSessionRef {
  id: string;
  model: string;
  tail: string;
}

export const MAX_CHATS = 200;
export const CHAT_TITLE_LENGTH = 60;

/** The chat's title: its first words, on one line. */
export function chatTitle(turns: readonly Message[]): string {
  const first = turns.find((m) => m.role === "user")?.content ?? "";
  const line = first.replace(/\s+/g, " ").trim();
  if (!line) return "New chat";
  return line.length > CHAT_TITLE_LENGTH ? `${line.slice(0, CHAT_TITLE_LENGTH - 1).trimEnd()}…` : line;
}

export function openChats(db: DatabaseSync, now: () => Date): ChatStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      chat_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      PRIMARY KEY (chat_id, seq)
    );
    CREATE INDEX IF NOT EXISTS chats_updated ON chats(updated_at);
  `);
  // ADR-097: a chat's own model; NULL uses the default. Added to files made before it.
  const columns = (db.prepare("PRAGMA table_info(chats)").all() as { name: string }[]).map((c) => c.name);
  if (!columns.includes("provider")) db.exec("ALTER TABLE chats ADD COLUMN provider TEXT");
  if (!columns.includes("model")) db.exec("ALTER TABLE chats ADD COLUMN model TEXT");
  // ADR-098 item 9: the chat's Claude Code session as JSON; NULL starts a fresh one.
  if (!columns.includes("session")) db.exec("ALTER TABLE chats ADD COLUMN session TEXT");
  const readSession = db.prepare("SELECT session FROM chats WHERE id = ?");
  const writeSession = db.prepare("UPDATE chats SET session = ? WHERE id = ?");
  const finder = chatSearch(db);
  const readModel = db.prepare("SELECT provider, model FROM chats WHERE id = ?");
  const writeModel = db.prepare("UPDATE chats SET provider = ?, model = ? WHERE id = ?");
  const upsert = db.prepare(
    "INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at",
  );
  const clear = db.prepare("DELETE FROM chat_messages WHERE chat_id = ?");
  const insert = db.prepare("INSERT INTO chat_messages (chat_id, seq, role, content) VALUES (?, ?, ?, ?)");
  const drop = db.prepare("DELETE FROM chats WHERE id = ?");
  const listed = db.prepare(
    "SELECT c.id, c.title, c.updated_at, (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id) AS n FROM chats c ORDER BY c.updated_at DESC, c.rowid DESC LIMIT ?",
  );
  const read = db.prepare("SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY seq");
  const old = db.prepare("SELECT id FROM chats ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?");

  return {
    save(id, turns) {
      const kept = turns.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
      if (!kept.length) return;
      const at = now().toISOString();
      db.exec("BEGIN");
      try {
        upsert.run(id, chatTitle(kept), at, at);
        clear.run(id);
        kept.forEach((m, i) => insert.run(id, i, m.role, m.content));
        for (const row of old.all(MAX_CHATS) as { id: string }[]) {
          clear.run(row.id);
          drop.run(row.id);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    list(limit = 50) {
      return (listed.all(limit) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        title: String(r.title),
        updatedAt: new Date(String(r.updated_at)),
        messages: Number(r.n),
      }));
    },

    messages(id) {
      return (read.all(id) as { role: "user" | "assistant"; content: string }[]).map((r) => ({ role: r.role, content: r.content }));
    },

    remove(id) {
      clear.run(id);
      return Number(drop.run(id).changes) > 0;
    },

    model(id) {
      const row = readModel.get(id) as { provider: string | null; model: string | null } | undefined;
      return row?.provider && row.model ? { provider: row.provider, model: row.model } : undefined;
    },

    session(id) {
      const row = readSession.get(id) as { session: string | null } | undefined;
      if (!row?.session) return undefined;
      try {
        const s = JSON.parse(row.session) as Partial<ChatSessionRef>;
        return typeof s.id === "string" && typeof s.model === "string" && typeof s.tail === "string" ? { id: s.id, model: s.model, tail: s.tail } : undefined;
      } catch {
        return undefined; // a damaged entry only means a fresh session
      }
    },

    setSession(id, session) {
      return Number(writeSession.run(JSON.stringify({ id: session.id, model: session.model, tail: session.tail }), id).changes) > 0;
    },

    setModel(id, choice) {
      return Number(writeModel.run(choice?.provider ?? null, choice?.model ?? null, id).changes) > 0;
    },

    search: (query) => finder.search(query),
  };
}
