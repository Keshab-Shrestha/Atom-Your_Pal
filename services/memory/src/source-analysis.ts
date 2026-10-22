import type { DatabaseSync } from "node:sqlite";
import { validChatBrief } from "./chats.ts";
import { createHash } from "node:crypto";
import type { Brain } from "./brain.ts";
import type { BrainSources } from "./brain-sources.ts";

export const analysisHash = (title: string, body: string, state: string) => createHash("sha256").update(JSON.stringify(["source-analysis-v1", title, body, state])).digest("hex");

export interface AnalysisProfile { provider: string; model: string; effort: string }
export interface AnalysisEntry { id: number; hash: string; chars: number }
export interface AnalysisJob {
  id: string; state: "running" | "paused" | "failed" | "done";
  reason?: "interrupted" | "user" | "foreground" | "budget" | "error" | "complete";
  profile: AnalysisProfile; entries: AnalysisEntry[]; index: number; offset: number;
  chunks: number; reused: number; calls: number; skipped: number; createdAt: string; updatedAt: string;
  lastResume?: string;
  message?: string;
}
export interface AnalysisSettings { enabled: boolean; minute: number; dailyLimit: number; createdAt: string; lastAt?: string; profile?: AnalysisProfile }
export interface AnalysisRecord { source: string; version: number; settings: AnalysisSettings; job?: AnalysisJob }
export interface AnalysisPart {
  source: string; note: number; hash: string; offset: number; end: number; title: string; checkedAt: string;
  text: string; createdAt: string; profile: AnalysisProfile;
}
export interface SourceAnalysisStore {
  read(): AnalysisRecord | undefined;
  put(record: AnalysisRecord, part?: AnalysisPart): AnalysisRecord;
  clear(source: string): void;
  budget(day: string): number;
  reserve(day: string, limit: number): boolean;
  cached(source: string, note: number, hash: string, offset: number, profile: AnalysisProfile): AnalysisPart | undefined;
  parts(source: string, before?: number): { rows: (AnalysisPart & { seq: number })[]; next?: number };
}

export const defaultAnalysisSettings = (at: string): AnalysisSettings => ({ enabled: false, minute: 120, dailyLimit: 3, createdAt: at });
const integer = (n: unknown, min: number, max: number) => Number.isSafeInteger(n) && Number(n) >= min && Number(n) <= max;
const date = (n: unknown) => typeof n === "string" && Number.isFinite(Date.parse(n));
export function validAnalysisProfile(value: unknown): value is AnalysisProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as AnalysisProfile;
  return Object.keys(p).every((key) => ["provider", "model", "effort"].includes(key)) && ["claude-plan", "codex"].includes(p.provider) && validChatBrief(p.model) && p.model.length > 0 && p.model.length <= 200
    && validChatBrief(p.effort) && p.effort.length > 0 && p.effort.length <= 32;
}
function checked(record: AnalysisRecord): AnalysisRecord {
  const s = record.settings, j = record.job;
  if (!record || !/^[\w-]{1,100}$/.test(record.source) || !integer(record.version, 0, 2_000_000_000)
    || !s || typeof s.enabled !== "boolean" || !integer(s.minute, 0, 1439) || !integer(s.dailyLimit, 1, 10) || !date(s.createdAt)
    || (s.lastAt !== undefined && !date(s.lastAt)) || (s.profile !== undefined && !validAnalysisProfile(s.profile)) || (s.enabled && !s.profile)) throw new Error("Analysis settings are unreadable. Clear analysis data and configure it again.");
  if (j && (!/^[\w-]{1,100}$/.test(j.id) || !["running", "paused", "failed", "done"].includes(j.state)
    || (j.reason !== undefined && !["interrupted", "user", "foreground", "budget", "error", "complete"].includes(j.reason))
    || !validAnalysisProfile(j.profile) || !Array.isArray(j.entries) || j.entries.length > 500
    || !j.entries.every((e) => integer(e.id, 1, Number.MAX_SAFE_INTEGER) && /^[a-f0-9]{64}$/.test(e.hash) && integer(e.chars, 0, 1_000_000))
    || new Set(j.entries.map((e) => e.id)).size !== j.entries.length || !integer(j.index, 0, j.entries.length) || !integer(j.offset, 0, j.entries[j.index]?.chars ?? 0)
    || ![j.chunks, j.reused, j.calls, j.skipped].every((n) => integer(n, 0, 100_000)) || !date(j.createdAt) || !date(j.updatedAt)
    || (j.lastResume !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(j.lastResume))
    || (j.message !== undefined && (!validChatBrief(j.message) || j.message.length > 300)))) throw new Error("Analysis progress is unreadable. Clear analysis data before starting again.");
  return record;
}

/** Only progress and derived reports; source text remains in the existing brain notes. */
export function openSourceAnalysis(db: DatabaseSync, brain: Brain, sources: BrainSources): SourceAnalysisStore {
  db.exec(`CREATE TABLE IF NOT EXISTS source_analysis_state (slot INTEGER PRIMARY KEY CHECK(slot = 1), source_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_analysis_parts (seq INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, note_id INTEGER NOT NULL, hash TEXT NOT NULL, offset INTEGER NOT NULL, profile TEXT NOT NULL, data TEXT NOT NULL,
      UNIQUE(source_id, note_id, hash, offset, profile));
    CREATE TABLE IF NOT EXISTS source_analysis_usage (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS source_analysis_removed AFTER DELETE ON brain_source_folder BEGIN
      DELETE FROM source_analysis_parts WHERE source_id = old.id;
      DELETE FROM source_analysis_state WHERE source_id = old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS source_analysis_note_deleted AFTER DELETE ON brain_notes BEGIN DELETE FROM source_analysis_parts WHERE note_id = old.id; END;
    CREATE TRIGGER IF NOT EXISTS source_analysis_note_edited AFTER UPDATE OF title, body, ghost ON brain_notes BEGIN DELETE FROM source_analysis_parts WHERE note_id = old.id; END;
    CREATE TRIGGER IF NOT EXISTS source_analysis_note_excluded AFTER UPDATE OF excluded ON brain_source_files WHEN new.excluded = 1 BEGIN DELETE FROM source_analysis_parts WHERE note_id = old.note_id; END;`);
  const profileKey = (p: AnalysisProfile) => JSON.stringify([p.provider, p.model, p.effort]);
  const read = (): AnalysisRecord | undefined => {
    const row = db.prepare("SELECT source_id, version, data FROM source_analysis_state WHERE slot = 1").get() as { source_id: string; version: number; data: string } | undefined;
    if (!row) return undefined;
    if (Buffer.byteLength(row.data) > 120_000) throw new Error("Analysis progress exceeds its metadata budget. Clear analysis data.");
    return checked({ ...JSON.parse(row.data), source: row.source_id, version: row.version });
  };
  function part(value: unknown): AnalysisPart {
    const p = value as AnalysisPart;
    if (!p || !integer(p.note, 1, Number.MAX_SAFE_INTEGER) || !integer(p.offset, 0, 1_000_000) || !integer(p.end, p.offset + 1, 1_000_000)
      || !/^[a-f0-9]{64}$/.test(p.hash) || !validAnalysisProfile(p.profile) || !validChatBrief(p.text) || !p.text.trim() || Buffer.byteLength(p.text) > 3500
      || !validChatBrief(p.title) || Buffer.byteLength(p.title) > 1000 || !date(p.checkedAt) || !date(p.createdAt)) throw new Error("An analysis report is unreadable. Clear analysis data to remove it.");
    return p;
  }
  return {
    read,
    put(record, result) {
      checked(record);
      db.exec("SAVEPOINT source_analysis_checkpoint");
      try {
        const current = read();
        if ((current?.version ?? 0) !== record.version || (current && current.source !== record.source)
          || !db.prepare("SELECT 1 FROM brain_source_folder WHERE id = ?").get(record.source)) throw new Error("The source or analysis progress changed. Reload before continuing.");
        const next = { ...record, version: record.version + 1 };
        db.prepare(`INSERT INTO source_analysis_state VALUES (1, ?, ?, ?) ON CONFLICT(slot) DO UPDATE SET source_id = excluded.source_id, version = excluded.version, data = excluded.data`)
          .run(next.source, next.version, JSON.stringify(next));
        if (result) {
          const p = part(result);
          if (p.source !== record.source || !db.prepare("SELECT 1 FROM brain_source_files WHERE note_id = ? AND excluded = 0").get(p.note)) throw new Error("The analysis note was removed.");
          const note = brain.get(p.note), origin = sources.note(p.note);
          if (!note || note.ghost || !origin || !["current", "corrected"].includes(origin.state) || analysisHash(note.title, note.body, origin.state) !== p.hash) throw new Error("The analysis note changed.");
          db.prepare("INSERT INTO source_analysis_parts(source_id, note_id, hash, offset, profile, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(source_id,note_id,hash,offset,profile) DO UPDATE SET data = excluded.data")
            .run(p.source, p.note, p.hash, p.offset, profileKey(p.profile), JSON.stringify(p));
          db.exec("DELETE FROM source_analysis_parts WHERE seq NOT IN (SELECT seq FROM source_analysis_parts ORDER BY seq DESC LIMIT 2500)");
        }
        db.exec("RELEASE source_analysis_checkpoint");
        return next;
      } catch (error) { db.exec("ROLLBACK TO source_analysis_checkpoint; RELEASE source_analysis_checkpoint"); throw error; }
    },
    clear(source) {
      db.exec("SAVEPOINT source_analysis_clear");
      try {
        if (!db.prepare("SELECT 1 FROM brain_source_folder WHERE id = ?").get(source)) throw new Error("The connected source changed.");
        db.prepare("DELETE FROM source_analysis_parts WHERE source_id = ?").run(source);
        const row = db.prepare("SELECT source_id, version FROM source_analysis_state WHERE slot = 1").get() as { source_id: string; version: number } | undefined;
        if (row && row.source_id !== source) {
          if (db.prepare("SELECT 1 FROM brain_source_folder WHERE id = ?").get(row.source_id)) throw new Error("The analysis source changed.");
          db.prepare("DELETE FROM source_analysis_parts WHERE source_id = ?").run(row.source_id); // orphaned derived data only
        }
        // Keep a monotonic version after Clear, including corrupt-JSON recovery, so old start packets stay stale.
        const reset = { settings: defaultAnalysisSettings(new Date().toISOString()) };
        db.prepare("INSERT INTO source_analysis_state VALUES (1, ?, ?, ?) ON CONFLICT(slot) DO UPDATE SET source_id = excluded.source_id, version = excluded.version, data = excluded.data")
          .run(source, (row?.version ?? 0) + 1, JSON.stringify(reset));
        db.exec("RELEASE source_analysis_clear");
      } catch (error) { db.exec("ROLLBACK TO source_analysis_clear; RELEASE source_analysis_clear"); throw error; }
    },
    budget: (day) => (db.prepare("SELECT attempts FROM source_analysis_usage WHERE day = ?").get(day) as { attempts: number } | undefined)?.attempts ?? 0,
    reserve(day, limit) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !integer(limit, 1, 10)) throw new Error("Invalid analysis budget.");
      const admitted = db.prepare("INSERT INTO source_analysis_usage VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ?").run(day, limit).changes > 0;
      db.prepare("DELETE FROM source_analysis_usage WHERE day < ?").run(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
      return admitted;
    },
    cached(source, note, hash, offset, profile) {
      const row = db.prepare("SELECT data FROM source_analysis_parts WHERE source_id = ? AND note_id = ? AND hash = ? AND offset = ? AND profile = ?").get(source, note, hash, offset, profileKey(profile)) as { data: string } | undefined;
      if (!row) return undefined;
      const result = part(JSON.parse(row.data));
      if (result.source !== source || result.note !== note || result.hash !== hash || result.offset !== offset || profileKey(result.profile) !== profileKey(profile)) throw new Error("Analysis cache identity changed. Clear the derived data.");
      return result;
    },
    parts(source, before = Number.MAX_SAFE_INTEGER) {
      const rows = db.prepare("SELECT seq, data FROM source_analysis_parts WHERE source_id = ? AND seq < ? ORDER BY seq DESC LIMIT 5").all(source, before) as { seq: number; data: string }[];
      return { rows: rows.map((row) => {
        const result = part(JSON.parse(row.data));
        if (result.source !== source) throw new Error("Analysis report belongs to another source.");
        return { ...result, seq: row.seq };
      }), ...(rows.length === 5 ? { next: rows[4]!.seq } : {}) };
    },
  };
}
