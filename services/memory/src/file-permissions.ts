import type { DatabaseSync } from "node:sqlite";

/** Explicit grants for one canonical file in one chat. Only the approval handler may call grant. */
export interface FilePermissionScope {
  has(path: string): boolean;
  grant(path: string): void;
  list(): string[];
  revokeAll(): number;
}

export interface FilePermissions {
  forChat(chatId: string): FilePermissionScope;
}

export function openFilePermissions(db: DatabaseSync): FilePermissions {
  db.exec(`CREATE TABLE IF NOT EXISTS file_permissions (
    chat_id TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (chat_id, path)
  )`);
  const has = db.prepare("SELECT 1 FROM file_permissions WHERE chat_id = ? AND path = ?");
  const grant = db.prepare("INSERT OR IGNORE INTO file_permissions (chat_id, path) VALUES (?, ?)");
  const list = db.prepare("SELECT path FROM file_permissions WHERE chat_id = ? ORDER BY path");
  const revoke = db.prepare("DELETE FROM file_permissions WHERE chat_id = ?");
  return {
    forChat(chatId) {
      return {
        has: (path) => Boolean(has.get(chatId, path)),
        grant: (path) => { grant.run(chatId, path); },
        list: () => (list.all(chatId) as { path: string }[]).map((r) => r.path),
        revokeAll: () => Number(revoke.run(chatId).changes),
      };
    },
  };
}
