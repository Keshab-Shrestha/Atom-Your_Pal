import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Message } from "@atom/contracts";
import { validChatBrief } from "./chats.ts";

export interface ContinuityItem { text: string; refs: number[] }
export interface ContinuitySummary {
  through: number; hash: string; items: ContinuityItem[]; provider: string; model: string; updatedAt: string;
}
export interface ContinuityState { enabled: boolean; version: number; summary?: ContinuitySummary; stale?: true }
export interface ChatContinuityStore {
  get(chat: string, messages?: readonly Message[]): ContinuityState;
  configure(chat: string, enabled: boolean, version: number): boolean;
  publish(chat: string, summary: ContinuitySummary, version: number): boolean;
}

export function continuityHash(messages: readonly Message[], through: number): string {
  const hash = createHash("sha256");
  for (const message of messages.slice(0, through)) hash.update(JSON.stringify([message.role, message.content])).update("\n");
  return hash.digest("hex");
}

/** References are range-checked, not proof that a model's paraphrase is accurate. */
export function continuityItems(value: unknown, through: number): ContinuityItem[] {
  if (!Array.isArray(value) || value.length > 24) throw new Error("Invalid continuity items.");
  const items = value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid continuity item.");
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["text", "refs"].includes(key)) || !validChatBrief(row.text) || !row.text.trim()
      || !Array.isArray(row.refs) || !row.refs.length || row.refs.length > 8
      || !row.refs.every((ref) => Number.isSafeInteger(ref) && ref >= 1 && ref <= through)) throw new Error("Invalid continuity text or references.");
    return { text: row.text.trim(), refs: [...new Set(row.refs as number[])] };
  });
  if (Buffer.byteLength(JSON.stringify(items)) > 6000) throw new Error("Continuity output exceeds its budget.");
  return items;
}

/** Derived data only. Never edits messages, user briefs, access modes or grants. */
export function openChatContinuity(db: DatabaseSync): ChatContinuityStore {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_continuity (
    chat_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 0, summary TEXT
  );
  CREATE TRIGGER IF NOT EXISTS chat_continuity_deleted AFTER DELETE ON chats BEGIN
    DELETE FROM chat_continuity WHERE chat_id = old.id;
  END;`);
  const read = db.prepare("SELECT enabled, version, summary FROM chat_continuity WHERE chat_id = ?");
  const exists = db.prepare("SELECT 1 FROM chats WHERE id = ?");
  const archive = db.prepare("SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY seq");
  const write = db.prepare(`INSERT INTO chat_continuity(chat_id, enabled, version, summary) VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET enabled = excluded.enabled, version = excluded.version, summary = excluded.summary`);
  function get(chat: string, messages?: readonly Message[]): ContinuityState {
    const row = read.get(chat) as { enabled: number; version: number; summary: string | null } | undefined;
    const state: ContinuityState = { enabled: row?.enabled !== 0, version: row?.version ?? 0 };
    if (!row?.summary || !state.enabled || !exists.get(chat)) return state;
    try {
      if (Buffer.byteLength(row.summary) > 10_000) throw new Error("Oversize derived copy.");
      const summary = JSON.parse(row.summary) as ContinuitySummary;
      const source = messages ?? archive.all(chat) as unknown as Message[];
      // Changed/replaced transcripts cannot inherit stale derived claims. Appends keep the prefix valid.
      if (!summary || !Number.isSafeInteger(summary.through) || summary.through <= 0 || summary.through > source.length
        || typeof summary.provider !== "string" || typeof summary.model !== "string" || typeof summary.updatedAt !== "string"
        || continuityHash(source, summary.through) !== summary.hash) throw new Error("Stale derived copy.");
      state.summary = { ...summary, items: continuityItems(summary.items, summary.through) };
    } catch { state.stale = true; } // discard derived claims, not original history; expose this in Saved context details
    return state;
  }
  function atomic<T>(work: () => T): T {
    db.exec("SAVEPOINT chat_continuity_write");
    try {
      const result = work();
      db.exec("RELEASE chat_continuity_write");
      return result;
    } catch (error) {
      db.exec("ROLLBACK TO chat_continuity_write; RELEASE chat_continuity_write");
      throw error;
    }
  }
  return {
    get,
    configure(chat, enabled, version) {
      return atomic(() => {
        if (!exists.get(chat)) return false;
        const current = get(chat);
        // A transport retry confirms the same change; no duplicate model job is started here.
        if (current.version === version + 1 && current.enabled === enabled && (read.get(chat) as { summary: string | null })?.summary === null) return true;
        if (current.version !== version) return false;
        write.run(chat, enabled ? 1 : 0, version + 1, null); // pause/enable both discard the previous derived copy
        return true;
      });
    },
    publish(chat, summary, version) {
      return atomic(() => {
        if (!exists.get(chat)) return false;
        const current = get(chat);
        const messages = archive.all(chat) as unknown as Message[];
        if (!current.enabled || current.version !== version || !Number.isSafeInteger(summary.through) || summary.through <= 0 || summary.through > messages.length
          || summary.through <= (current.summary?.through ?? 0) || continuityHash(messages, summary.through) !== summary.hash) return false;
        const checked = { ...summary, items: continuityItems(summary.items, summary.through) };
        write.run(chat, 1, version + 1, JSON.stringify(checked));
        return true;
      });
    },
  };
}
