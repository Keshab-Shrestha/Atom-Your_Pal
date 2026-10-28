import type { DatabaseSync } from "node:sqlite";

// ADR-098 item 6: the window's one search, the chats part. Each chat message is in an FTS5 table, kept in step with
// chat_messages by triggers. Results carry the chat's id, title, a short snippet and the date. Never logged.

/** Most results per kind. */
export const SEARCH_LIMIT = 20;

export interface ChatSearchHit {
  id: string;
  title: string;
  snippet: string;
  updatedAt: Date;
}

/**
 * Keshab's words as an FTS5 query: each word quoted (so no FTS syntax gets through) and matched as a prefix; all words
 * must match. Undefined when there are no words.
 */
export function searchMatch(text: string): string | undefined {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words?.length) return undefined;
  return [...new Set(words)].slice(0, 12).map((w) => `"${w}"*`).join(" ");
}

export function chatSearch(db: DatabaseSync) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'chat_fts'").get() !== undefined;
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chat_fts USING fts5(text, chat_id UNINDEXED);
    CREATE TRIGGER IF NOT EXISTS chat_fts_insert AFTER INSERT ON chat_messages BEGIN
      INSERT INTO chat_fts (rowid, text, chat_id) VALUES (new.rowid, new.content, new.chat_id);
    END;
    CREATE TRIGGER IF NOT EXISTS chat_fts_delete AFTER DELETE ON chat_messages BEGIN
      DELETE FROM chat_fts WHERE rowid = old.rowid;
    END;
  `);
  // A file from before the search: index the messages it already has, once.
  if (!exists) db.exec("INSERT INTO chat_fts (rowid, text, chat_id) SELECT rowid, content, chat_id FROM chat_messages");
  const matches = db.prepare(
    `SELECT c.id, c.title, c.updated_at, snippet(chat_fts, 0, '', '', '…', 12) AS snip FROM chat_fts
     JOIN chats c ON c.id = chat_fts.chat_id WHERE chat_fts MATCH ? ORDER BY rank LIMIT 400`,
  );
  return {
    /** The best match per chat, best chats first, at most SEARCH_LIMIT. */
    search(query: string): ChatSearchHit[] {
      const match = searchMatch(query);
      if (!match) return [];
      const seen = new Map<string, ChatSearchHit>();
      for (const r of matches.all(match) as { id: string; title: string; updated_at: string; snip: string }[]) {
        if (seen.has(r.id)) continue;
        seen.set(r.id, { id: r.id, title: r.title, snippet: r.snip.replace(/\s+/g, " ").trim(), updatedAt: new Date(r.updated_at) });
        if (seen.size >= SEARCH_LIMIT) break;
      }
      return [...seen.values()];
    },
  };
}
