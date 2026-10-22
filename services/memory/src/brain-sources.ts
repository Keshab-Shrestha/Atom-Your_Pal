import type { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import type { Brain, BrainNote } from "./brain.ts";

export interface SourceFile { path: string; title: string; body: string; hash: string }
export interface SourceFolder { id: string; path: string; identity: string; checkedAt: string; skipped: number }
export interface NoteSource {
  path: string; relativePath: string; checkedAt: string;
  state: "current" | "corrected" | "conflict" | "missing";
}
export interface SourceSummary {
  folder?: SourceFolder;
  notes: number; corrected: number; conflicts: number; missing: number; excluded: number;
}
export interface BrainSources {
  folder?(): SourceFolder | undefined;
  ids?(): number[];
  summary(): SourceSummary;
  note(id: number): NoteSource | undefined;
  /** Applies a complete bounded scan atomically. Source files are never written. */
  apply(folder: { path: string; identity: string }, files: readonly SourceFile[], skipped: number, restore?: number): void;
  /** A local delete is a lasting exclusion while this folder remains connected. */
  exclude(id: number): boolean;
  disconnect(): void;
}
interface Item { path: string; note_id: number | null; source_hash: string; note_hash: string; observed_hash: string | null; excluded: number }
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const noteHash = (note: BrainNote) => digest(JSON.stringify([note.title, note.body]));

/** Metadata only; the existing brain is the sole content/search/link store. */
export function openBrainSources(db: DatabaseSync, brain: Brain, now: () => Date): BrainSources {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_source_folder (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1), id TEXT NOT NULL, path TEXT NOT NULL,
      identity TEXT NOT NULL, checked_at TEXT NOT NULL, skipped INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS brain_source_files (
      path TEXT PRIMARY KEY, note_id INTEGER, source_hash TEXT NOT NULL, note_hash TEXT NOT NULL,
      observed_hash TEXT, excluded INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS brain_source_note ON brain_source_files(note_id);
  `);
  const folder = (): SourceFolder | undefined => {
    const row = db.prepare("SELECT id, path, identity, checked_at AS checkedAt, skipped FROM brain_source_folder WHERE singleton = 1").get();
    return row as unknown as SourceFolder | undefined;
  };
  const items = () => db.prepare("SELECT * FROM brain_source_files ORDER BY path").all() as unknown as Item[];
  const find = (id: number) => db.prepare("SELECT * FROM brain_source_files WHERE note_id = ? AND excluded = 0").get(id) as Item | undefined;
  const transaction = (work: () => void) => {
    db.exec("SAVEPOINT brain_source_update");
    try { work(); db.exec("RELEASE brain_source_update"); }
    catch (error) { db.exec("ROLLBACK TO brain_source_update; RELEASE brain_source_update"); throw error; }
  };
  function state(item: Item): NoteSource["state"] {
    if (item.observed_hash === null) return "missing";
    const note = item.note_id === null ? undefined : brain.get(item.note_id);
    if (note && noteHash(note) !== item.note_hash) return item.observed_hash !== item.source_hash ? "conflict" : "corrected";
    return "current";
  }
  return {
    folder,
    ids: () => items().filter((item) => !item.excluded && item.note_id !== null).map((item) => item.note_id!),
    summary() {
      const result: SourceSummary = { folder: folder(), notes: 0, corrected: 0, conflicts: 0, missing: 0, excluded: 0 };
      for (const item of items()) {
        if (item.excluded) { result.excluded++; continue; }
        if (item.note_id === null || !brain.get(item.note_id)) continue;
        result.notes++;
        const status = state(item);
        if (status === "corrected") result.corrected++;
        if (status === "conflict") result.conflicts++;
        if (status === "missing") result.missing++;
      }
      return result;
    },
    note(id) {
      const item = find(id), source = folder();
      return item && source ? { path: source.path, relativePath: item.path, checkedAt: source.checkedAt, state: state(item) } : undefined;
    },
    apply(input, files, skipped, restore) {
      const previous = folder();
      if (previous && (previous.path !== input.path || previous.identity !== input.identity)) throw new Error("The connected folder changed. Remove it and preview the intended folder again.");
      if (restore !== undefined && (!find(restore) || !files.some((file) => file.path === find(restore)!.path))) throw new Error("That source file is missing or was skipped. Its local correction was kept.");
      transaction(() => {
        const id = previous?.id ?? randomUUID();
        db.prepare("INSERT INTO brain_source_folder VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET checked_at = excluded.checked_at, skipped = excluded.skipped")
          .run(id, input.path, input.identity, now().toISOString(), skipped);
        const before = new Map(items().map((item) => [item.path, item]));
        db.prepare("UPDATE brain_source_files SET observed_hash = NULL").run();
        for (const file of files) {
          const old = before.get(file.path);
          if (old?.excluded) continue;
          const note = old?.note_id == null ? undefined : brain.get(old.note_id);
          if (old && !note) { db.prepare("UPDATE brain_source_files SET excluded = 1, note_id = NULL WHERE path = ?").run(file.path); continue; }
          if (old && note && noteHash(note) !== old.note_hash && restore !== note.id) {
            db.prepare("UPDATE brain_source_files SET observed_hash = ? WHERE path = ?").run(file.hash, file.path);
            continue; // preserve all user corrections; never let a refresh win a conflict
          }
          if (old && note && old.source_hash === file.hash && restore !== note.id) {
            db.prepare("UPDATE brain_source_files SET observed_hash = ? WHERE path = ?").run(file.hash, file.path);
            continue;
          }
          let title = note && restore !== note.id ? note.title : file.title;
          if (!note || restore === note.id) {
            const base = title;
            for (let n = 2; brain.byTitle(title) && brain.byTitle(title)!.id !== note?.id && !brain.byTitle(title)!.ghost; n++) title = `${base} (${n})`;
          }
          const saved = brain.save({ ...(note ? { id: note.id } : {}), title, body: file.body, kind: "note", ref: `source:${id}:${digest(file.path)}`, preserveWhitespace: true });
          db.prepare("INSERT INTO brain_source_files VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT(path) DO UPDATE SET note_id = excluded.note_id, source_hash = excluded.source_hash, note_hash = excluded.note_hash, observed_hash = excluded.observed_hash")
            .run(file.path, saved.id, file.hash, noteHash(saved), file.hash);
        }
      });
    },
    exclude(id) {
      if (!find(id)) return false;
      transaction(() => {
        brain.remove(id);
        db.prepare("UPDATE brain_source_files SET excluded = 1, note_id = NULL WHERE note_id = ?").run(id);
      });
      return true;
    },
    disconnect() {
      transaction(() => {
        for (const item of items()) if (!item.excluded && item.note_id !== null) brain.remove(item.note_id);
        db.prepare("DELETE FROM brain_source_files").run();
        db.prepare("DELETE FROM brain_source_folder").run();
      });
    },
  };
}
