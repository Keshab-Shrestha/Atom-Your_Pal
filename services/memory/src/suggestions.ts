import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { looksSecret } from "./tools.ts";
import { MAX_MEMORY_CHARS, MemoryError, type Memory, type MemoryStore } from "./store.ts";

// Remembering by itself (upgrades.md C2): the background conversation note may also propose lasting facts about the user.
// 2026-11-04 (Keshab: "make sure chat auto remembers, no need for asking"): while this is on, `remember` keeps each proposal at
// once, through the same checks as Accept, and one that fails a check stays as a suggestion to edit. Memory's page lists, edits
// and forgets every fact. The text below is the older, ask-first design, which is still how a refused one waits.
// A proposal is a suggestion, never a fact: it waits for the user's Accept. Accepting keeps it through the same checks as the
// `remember` tool; denying remembers a hash of the text so it is never suggested again. Suggestions expire after 14 days, at
// most 3 wait at once, and nothing here is ever spoken or sent anywhere.

export const MAX_PENDING_SUGGESTIONS = 3;
export const SUGGESTION_DAYS = 14;
/** At most this many candidate facts are read from one note. */
export const MAX_CANDIDATES = 3;

export interface Suggestion {
  id: number;
  text: string;
  /** The chat it was noticed in. */
  chatId: string;
  createdAt: Date;
}

/** A fact kept by itself, shown as a receipt for a short while. */
export interface KeptFact {
  /** The memory id. */
  id: number;
  text: string;
}
export const KEPT_MINUTES = 10;
const MAX_KEPT = 3;

export interface Suggestions {
  /** Whether new suggestions are made at all (default on). Existing ones stay until answered. */
  enabled(): boolean;
  setEnabled(on: boolean): void;
  /** Adds the candidates that pass the checks; returns those added. Never throws for a bad candidate. */
  suggest(candidates: readonly string[], chatId: string): Suggestion[];
  /** Suggests the candidates and keeps each at once (the same checks as `accept`). Returns the facts kept; a refused one waits as a suggestion. */
  remember(candidates: readonly string[], chatId: string): Memory[];
  /** The ones that wait, oldest first; expired ones are dropped first. */
  pending(): Suggestion[];
  /** Facts `remember` kept in the last 10 minutes, newest last: the receipt the chat shows with Undo. Not stored; a restart clears it. */
  kept(): KeptFact[];
  /** Undoes a kept fact: forgets it and never suggests or keeps that text by itself again. False when it is not a recent receipt. */
  undo(memoryId: number): boolean;
  /** Never suggests or keeps this text by itself again (the user forgot it). */
  block(text: string): void;
  /** Keeps the fact (`text` is the user's edit, if any) through the `remember` checks. Throws MemoryError with words. */
  accept(id: number, text?: string): Memory;
  /** Drops it for good and never suggests that text again. Returns false when it does not wait. */
  deny(id: number): boolean;
  /** Called after any change (a suggestion added, answered or expired). Returns an unsubscribe. */
  onChange(listener: () => void): () => void;
}

/** The same fact in other letters, spaces or width is the same fact. */
export const foldFact = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/[.。]+$/u, "").trim();
const hashOf = (text: string) => createHash("sha256").update(foldFact(text)).digest("hex").slice(0, 32);

/** The facts in a note run's answer: only strings, trimmed, at most `MAX_CANDIDATES`. Anything else reads as none. */
export function parseCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, MAX_CANDIDATES);
}

type Row = { id: number; text: string; chat_id: string; created_at: string };
const toSuggestion = (r: Row): Suggestion => ({ id: r.id, text: r.text, chatId: r.chat_id, createdAt: new Date(r.created_at) });

export function openSuggestions(db: DatabaseSync, store: Pick<MemoryStore, "add" | "recent" | "count" | "get" | "remove">, now: () => Date): Suggestions {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fact_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      hash TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS denied_facts (hash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS suggestion_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const insert = db.prepare("INSERT INTO fact_suggestions (text, hash, chat_id, created_at) VALUES (?, ?, ?, ?)");
  const all = db.prepare("SELECT * FROM fact_suggestions ORDER BY id");
  const byId = db.prepare("SELECT * FROM fact_suggestions WHERE id = ?");
  const byHash = db.prepare("SELECT id FROM fact_suggestions WHERE hash = ?");
  const remove = db.prepare("DELETE FROM fact_suggestions WHERE id = ?");
  const expire = db.prepare("DELETE FROM fact_suggestions WHERE created_at < ?");
  const denied = db.prepare("SELECT 1 FROM denied_facts WHERE hash = ?");
  const deny = db.prepare("INSERT OR IGNORE INTO denied_facts (hash) VALUES (?)");
  const setting = db.prepare("SELECT value FROM suggestion_settings WHERE key = 'enabled'");
  const putSetting = db.prepare("INSERT INTO suggestion_settings (key, value) VALUES ('enabled', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // a listener never stops the others
      }
    }
  };

  /** Drops the ones older than 14 days; true when any went. */
  const sweep = (): boolean => {
    const cutoff = new Date(now().getTime() - SUGGESTION_DAYS * 86_400_000).toISOString();
    return Number(expire.run(cutoff).changes) > 0;
  };
  const receipts: { id: number; text: string; at: number }[] = [];
  const liveReceipts = () => {
    const cutoff = now().getTime() - KEPT_MINUTES * 60_000;
    return receipts.filter((r) => r.at >= cutoff && store.get(r.id)).slice(-MAX_KEPT);
  };
  const known = (hash: string) => store.recent(store.count()).some((m) => hashOf(m.text) === hash);

  return {
    enabled: () => (setting.get() as { value: string } | undefined)?.value !== "off",
    setEnabled(on) {
      putSetting.run(on ? "on" : "off");
      changed();
    },

    suggest(candidates, chatId) {
      if (sweep()) changed();
      const added: Suggestion[] = [];
      for (const raw of candidates) {
        const text = raw.replace(/\s+/g, " ").trim();
        if (!text || text.length > MAX_MEMORY_CHARS || looksSecret(text)) continue;
        const hash = hashOf(text);
        if (denied.get(hash) || byHash.get(hash) || known(hash)) continue;
        if ((all.all() as Row[]).length >= MAX_PENDING_SUGGESTIONS) break;
        const id = Number(insert.run(text, hash, chatId, now().toISOString()).lastInsertRowid);
        added.push(toSuggestion(byId.get(id) as unknown as Row));
      }
      if (added.length) changed();
      return added;
    },

    remember(candidates, chatId) {
      const kept: Memory[] = [];
      for (const suggestion of this.suggest(candidates, chatId)) {
        try {
          const memory = this.accept(suggestion.id);
          kept.push(memory);
          receipts.push({ id: memory.id, text: memory.text, at: now().getTime() });
        } catch { /* a refused fact waits as a suggestion Keshab can edit */ }
      }
      if (kept.length) changed();
      return kept;
    },

    pending() {
      if (sweep()) changed();
      return (all.all() as unknown as Row[]).map(toSuggestion);
    },

    kept: () => liveReceipts().map((r) => ({ id: r.id, text: r.text })),

    undo(memoryId) {
      const receipt = liveReceipts().find((r) => r.id === memoryId);
      if (!receipt || !store.remove(memoryId)) return false;
      deny.run(hashOf(receipt.text));
      receipts.splice(receipts.indexOf(receipt), 1);
      changed();
      return true;
    },

    block(text) {
      deny.run(hashOf(text));
    },

    accept(id, edited) {
      const row = byId.get(id) as Row | undefined;
      if (!row) throw new MemoryError("That suggestion is gone.");
      const text = (edited ?? row.text).replace(/\s+/g, " ").trim();
      if (!text) throw new MemoryError("Say what to remember: the fact is empty.");
      if (looksSecret(text)) throw new MemoryError("That looks like a password or other secret; ARK does not keep those.");
      // The same checks and limits as the remember tool; a refusal leaves the suggestion waiting so it can be edited.
      const memory = store.add(text, { source: "text" });
      remove.run(id);
      changed();
      return memory;
    },

    deny(id) {
      const row = byId.get(id) as Row | undefined;
      if (!row) return false;
      deny.run(hashOf(row.text));
      remove.run(id);
      changed();
      return true;
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
