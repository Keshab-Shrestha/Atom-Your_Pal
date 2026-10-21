import type { DatabaseSync } from "node:sqlite";
import { HelperError } from "./jobs.ts";

// ADR-098 item 6: labels on tasks, and the window's one search over tasks, task notes, labels and reports. Task text,
// notes and reports are in FTS5 tables kept in step with their tables by triggers. Never logged (callers log counts).

export const MAX_LABELS = 6;
/** Most results per kind. */
export const SEARCH_LIMIT = 20;
const LABEL = /^[a-z0-9][a-z0-9 -]*$/;

export interface TaskSearchHit {
  /** The task's id (a report's task too). */
  id: number;
  title: string;
  snippet: string;
  at: Date;
}

/** A label as stored: trimmed, lower-case, single spaces. Throws HelperError for anything else. */
export function cleanLabel(raw: string): string {
  const label = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!label) throw new HelperError("The label is empty.");
  if (!LABEL.test(label)) throw new HelperError("A label has only letters a to z, digits, dashes and spaces.");
  return label;
}

/** Keshab's words as an FTS5 query: each word quoted (no FTS syntax gets through), as a prefix; all must match. */
export function searchMatch(text: string): string | undefined {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!words?.length) return undefined;
  return [...new Set(words)].slice(0, 12).map((w) => `"${w}"*`).join(" ");
}

const oneLine = (text: string, max = 120) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** Creates (once) the labels table, the FTS tables and their triggers, and fills the FTS tables of an older file. */
function createSearchSchema(db: DatabaseSync) {
  const exists = (name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name) !== undefined;
  const had = { tasks: exists("task_fts"), notes: exists("note_fts"), reports: exists("report_fts") };
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_labels (
      job_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      PRIMARY KEY (job_id, label)
    );
    CREATE INDEX IF NOT EXISTS job_labels_label ON job_labels(label);
    CREATE TRIGGER IF NOT EXISTS job_labels_gone AFTER DELETE ON jobs BEGIN
      DELETE FROM job_labels WHERE job_id = old.id;
    END;
    CREATE VIRTUAL TABLE IF NOT EXISTS task_fts USING fts5(text);
    CREATE TRIGGER IF NOT EXISTS task_fts_insert AFTER INSERT ON jobs BEGIN
      INSERT INTO task_fts (rowid, text) VALUES (new.id, new.task);
    END;
    CREATE TRIGGER IF NOT EXISTS task_fts_update AFTER UPDATE OF task ON jobs BEGIN
      DELETE FROM task_fts WHERE rowid = old.id;
      INSERT INTO task_fts (rowid, text) VALUES (new.id, new.task);
    END;
    CREATE TRIGGER IF NOT EXISTS task_fts_delete AFTER DELETE ON jobs BEGIN
      DELETE FROM task_fts WHERE rowid = old.id;
    END;
    CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(text, job_id UNINDEXED);
    CREATE TRIGGER IF NOT EXISTS note_fts_insert AFTER INSERT ON job_comments BEGIN
      INSERT INTO note_fts (rowid, text, job_id) VALUES (new.id, new.text, new.job_id);
    END;
    CREATE TRIGGER IF NOT EXISTS note_fts_delete AFTER DELETE ON job_comments BEGIN
      DELETE FROM note_fts WHERE rowid = old.id;
    END;
    CREATE VIRTUAL TABLE IF NOT EXISTS report_fts USING fts5(title, summary, body);
    -- Reports are written with INSERT OR REPLACE: the old words go before the new row, whatever the conflict handling.
    CREATE TRIGGER IF NOT EXISTS report_fts_replace BEFORE INSERT ON reports BEGIN
      DELETE FROM report_fts WHERE rowid = new.job_id;
    END;
    CREATE TRIGGER IF NOT EXISTS report_fts_insert AFTER INSERT ON reports BEGIN
      INSERT INTO report_fts (rowid, title, summary, body) VALUES (new.job_id, new.title, new.summary, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS report_fts_delete AFTER DELETE ON reports BEGIN
      DELETE FROM report_fts WHERE rowid = old.job_id;
    END;
  `);
  if (!had.tasks) db.exec("INSERT INTO task_fts (rowid, text) SELECT id, task FROM jobs");
  if (!had.notes) db.exec("INSERT INTO note_fts (rowid, text, job_id) SELECT id, text, job_id FROM job_comments");
  if (!had.reports) db.exec("INSERT INTO report_fts (rowid, title, summary, body) SELECT job_id, title, summary, body FROM reports");
}

export function searchTable(db: DatabaseSync) {
  createSearchSchema(db);
  const labelsOf = db.prepare("SELECT label FROM job_labels WHERE job_id = ? ORDER BY label");
  const putLabel = db.prepare("INSERT OR IGNORE INTO job_labels (job_id, label) VALUES (?, ?)");
  const dropLabel = db.prepare("DELETE FROM job_labels WHERE job_id = ? AND label = ?");
  const inUse = db.prepare("SELECT DISTINCT label FROM job_labels ORDER BY label");
  const fields = "j.id, j.task, j.created_at, j.ended_at, r.title";
  const taskHits = db.prepare(
    `SELECT ${fields}, snippet(task_fts, 0, '', '', '…', 12) AS snip FROM task_fts JOIN jobs j ON j.id = task_fts.rowid
     LEFT JOIN reports r ON r.job_id = j.id WHERE task_fts MATCH ? ORDER BY rank LIMIT ${SEARCH_LIMIT}`,
  );
  const noteHits = db.prepare(
    `SELECT ${fields}, snippet(note_fts, 0, '', '', '…', 12) AS snip FROM note_fts JOIN jobs j ON j.id = note_fts.job_id
     LEFT JOIN reports r ON r.job_id = j.id WHERE note_fts MATCH ? ORDER BY rank LIMIT ${SEARCH_LIMIT * 4}`,
  );
  const labelHits = db.prepare(
    `SELECT ${fields}, l.label AS snip FROM job_labels l JOIN jobs j ON j.id = l.job_id LEFT JOIN reports r ON r.job_id = j.id
     WHERE instr(l.label, ?) > 0 ORDER BY j.id DESC LIMIT ${SEARCH_LIMIT}`,
  );
  const reportHits = db.prepare(
    `SELECT ${fields}, snippet(report_fts, -1, '', '', '…', 12) AS snip FROM report_fts JOIN jobs j ON j.id = report_fts.rowid
     JOIN reports r ON r.job_id = j.id WHERE report_fts MATCH ? ORDER BY rank LIMIT ${SEARCH_LIMIT}`,
  );
  type Row = { id: number; task: string; created_at: string; ended_at: string | null; title: string | null; snip: string };
  const toHit = (r: Row, snippet = r.snip): TaskSearchHit => ({
    id: r.id,
    title: oneLine(r.title ?? r.task.split("\n")[0] ?? "", 80),
    snippet: oneLine(snippet),
    at: new Date(r.ended_at ?? r.created_at),
  });
  const labels = (id: number) => (labelsOf.all(id) as { label: string }[]).map((r) => r.label);

  return {
    /** A task's labels, sorted; the field is absent when it has none. */
    labelsField(id: number): { labels?: string[] } {
      const list = labels(id);
      return list.length ? { labels: list } : {};
    },
    /** Adds a cleaned label (nothing when it is there already). Throws HelperError for a bad label or one too many. */
    add(id: number, raw: string): string {
      const label = cleanLabel(raw);
      const now = labels(id);
      if (now.length >= MAX_LABELS && !now.includes(label)) throw new HelperError(`A task has at most ${MAX_LABELS} labels.`);
      putLabel.run(id, label);
      return label;
    },
    remove: (id: number, label: string) => Number(dropLabel.run(id, label.trim().toLowerCase()).changes) > 0,
    /** Every label on some task, sorted. */
    inUse: () => (inUse.all() as { label: string }[]).map((r) => r.label),
    /** Tasks (by task text, labels and notes) and reports, each best first, at most SEARCH_LIMIT of each. */
    search(query: string): { tasks: TaskSearchHit[]; reports: TaskSearchHit[] } {
      const match = searchMatch(query);
      const words = query.trim().toLowerCase().replace(/\s+/g, " ");
      const tasks = new Map<number, TaskSearchHit>();
      const add = (rows: Row[], snippet?: (r: Row) => string) => {
        for (const r of rows) if (tasks.size < SEARCH_LIMIT && !tasks.has(r.id)) tasks.set(r.id, toHit(r, snippet?.(r)));
      };
      if (match) add(taskHits.all(match) as Row[]);
      if (words) add(labelHits.all(words) as Row[], (r) => `Label: ${r.snip}`);
      if (match) add(noteHits.all(match) as Row[], (r) => `Note: ${r.snip}`);
      const reports = match ? (reportHits.all(match) as Row[]).map((r) => toHit(r)) : [];
      return { tasks: [...tasks.values()], reports };
    },
  };
}
