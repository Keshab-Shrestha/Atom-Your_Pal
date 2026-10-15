import { createHash } from "node:crypto";
import { chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { DENY_READ_DIRS, isInside, pathProblem, realish } from "./grants.ts";

/**
 * B3.4, ADR-101: checkpoint and undo of a run's file edits. Before the first edit of a file in a run, ATOM copies the
 * file (or notes that it is new). Keshab can then undo one file or the whole run. Files in a git worktree are not
 * copied (git covers them); edits made by Bash are not tracked. The copies live in `<dir>/<job>/<n>` (flat numbered
 * files, never named after the original path), are never sent to a model, and their content is never logged.
 */

export const CHECKPOINT_FILE_BYTES = 5 * 1024 * 1024;
export const CHECKPOINT_JOB_BYTES = 50 * 1024 * 1024;
export const CHECKPOINT_JOB_FILES = 200;
/** The thread lists this many files. */
export const CHECKPOINTS_LISTED = 100;
/** A finished task keeps its copies this long. */
export const CHECKPOINT_KEEP_DAYS = 14;

export type CheckpointKind = "modified" | "created";
export type CheckpointState = "ready" | "changed" | "undone" | "skipped";
export interface CheckpointItem {
  /** Relative to its grant root. */
  path: string;
  kind: CheckpointKind;
  state: CheckpointState;
  reason?: string;
}
export type UndoOutcome = "restored" | "conflict" | "missing" | "skipped" | "refused";
export interface UndoResult {
  path: string;
  result: UndoOutcome;
  reason?: string;
}

export const CHECKPOINTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS checkpoints (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    rel TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('modified', 'created')),
    state TEXT NOT NULL CHECK (state IN ('ready', 'undone', 'skipped')),
    reason TEXT,
    size INTEGER,
    sha_before TEXT,
    sha_after TEXT,
    snap TEXT,
    UNIQUE (job_id, path)
  );
`;

// Same words as touchesSecretFile in the gateway's tool-summary.ts (the gateway does not depend on helpers); both are tested.
const SECRET_FILE_PATH = /(^|[\s/="'])\.env(\.[\w.-]+)?(?=$|[\s"'])|data\/api-token/;
/** Does this path or command touch .env or data/api-token? */
export const touchesSecretFile = (text: string) => SECRET_FILE_PATH.test(text);

/** ATOM's own databases (2026-10-15): they hold MCP secrets and every chat, so no agent opens them, whatever folder it was granted. */
const ATOM_DATABASE = /(^|\/)data\/(helpers|memory)\.db(-wal|-shm)?$/;

/** A path whose content is never copied: .env files, the API token, keys, and anything in a folder commands cannot read. */
export function isSecretLike(path: string, home: string): boolean {
  const name = basename(path);
  if (name.startsWith(".env") || /\.pem$/i.test(name) || name.startsWith("id_rsa") || touchesSecretFile(path) || ATOM_DATABASE.test(path)) return true;
  return DENY_READ_DIRS.some((d) => isInside(join(realish(home), d), path) || isInside(join(home, d), path));
}

/** SHA-256 of a file, read in chunks. */
export function sha256File(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const chunk = Buffer.alloc(64 * 1024);
    for (let n = readSync(fd, chunk, 0, chunk.length, null); n > 0; n = readSync(fd, chunk, 0, chunk.length, null)) hash.update(chunk.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

type Row = { id: number; job_id: number; path: string; rel: string; kind: CheckpointKind; state: "ready" | "undone" | "skipped"; reason: string | null; size: number | null; sha_before: string | null; sha_after: string | null; snap: string | null };

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
const lstatOrUndefined = (path: string) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
};
const hashOrNull = (path: string) => (lstatOrUndefined(path)?.isFile() ? sha256File(path) : null);

export function checkpointTable(db: DatabaseSync, dir: string | undefined, home: string) {
  db.exec(CHECKPOINTS_SCHEMA);
  const byPath = db.prepare("SELECT * FROM checkpoints WHERE job_id = ? AND path = ?");
  const byJob = db.prepare("SELECT * FROM checkpoints WHERE job_id = ? ORDER BY id");
  const usage = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM checkpoints WHERE job_id = ? AND state = 'ready' AND kind = 'modified'");
  const count = db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE job_id = ? AND state = 'ready'");
  const insert = db.prepare("INSERT INTO checkpoints (job_id, path, rel, kind, state, reason, size) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const fill = db.prepare("UPDATE checkpoints SET sha_before = ?, snap = ? WHERE id = ?");
  const mark = db.prepare("UPDATE checkpoints SET state = ?, reason = ? WHERE id = ?");
  const after = db.prepare("UPDATE checkpoints SET sha_after = ? WHERE id = ?");
  const remove = db.prepare("DELETE FROM checkpoints WHERE id = ?");
  const dropJob = db.prepare("DELETE FROM checkpoints WHERE job_id = ?");

  const jobDir = (jobId: number) => join(dir!, String(jobId));
  const snapPath = (row: Row) => join(jobDir(row.job_id), row.snap ?? "");
  const forget = (row: Row) => {
    if (dir && row.snap) rmSync(snapPath(row), { force: true });
    remove.run(row.id);
  };
  const rowsOf = (jobId: number) => byJob.all(jobId) as unknown as Row[];

  /** Hashes the file of every ready row of this task that has no "after" yet (a crash left them). */
  function finishRows(rows: Row[], onlyMissing: boolean) {
    for (const row of rows) {
      if (row.state !== "ready" || (onlyMissing && row.sha_after !== null)) continue;
      const sha = hashOrNull(row.path);
      // The run changed nothing in this file: there is nothing to undo.
      if (row.kind === "modified" && sha === row.sha_before) forget(row);
      else after.run(sha, row.id);
    }
  }
  // After a crash the file as it is now is the best "after".
  for (const row of db.prepare("SELECT * FROM checkpoints WHERE state = 'ready' AND sha_after IS NULL").all() as unknown as Row[]) finishRows([row], true);

  const drop = (jobId: number) => {
    dropJob.run(jobId);
    if (dir) rmSync(jobDir(jobId), { recursive: true, force: true });
  };
  const skipRow = (jobId: number, path: string, rel: string, kind: CheckpointKind, reason: string) => {
    insert.run(jobId, path, rel, kind, "skipped", reason, null);
    return "skipped" as const;
  };

  return {
    /**
     * Before the first edit of a file in a task: keeps the original (or notes the file is new). Returns the new row's
     * state, or undefined when this task already has one for the file. Never throws for a file it cannot keep: that is a
     * "skipped" row with the reason.
     */
    capture(jobId: number, roots: readonly string[], absPath: string): "ready" | "skipped" | undefined {
      if (!dir) return undefined;
      const requested = resolve(absPath);
      const real = realish(requested);
      const grantRoots = roots.map((r) => realish(r));
      const root = grantRoots.find((r) => isInside(r, real));
      const key = root ? real : requested;
      const old = byPath.get(jobId, key) as Row | undefined;
      if (old?.state === "undone") forget(old); // the file is edited again: a new copy
      else if (old) return undefined;
      const shown = root ?? grantRoots.find((r) => isInside(r, requested));
      const rel = shown ? relative(shown, root ? real : requested) : basename(requested);
      const existing = root ? lstatOrUndefined(real) : undefined;
      const kind: CheckpointKind = existing ? "modified" : "created";
      if (!root) return skipRow(jobId, key, rel, kind, "outside the folders");
      if (real.split(sep).includes(".git")) return skipRow(jobId, key, rel, kind, "git's own file");
      if (isSecretLike(real, home) || isSecretLike(requested, home)) return skipRow(jobId, key, rel, kind, "secret file");
      if ((count.get(jobId) as { n: number }).n >= CHECKPOINT_JOB_FILES) return skipRow(jobId, key, rel, kind, "too many files");
      if (!existing) {
        insert.run(jobId, key, rel, "created", "ready", null, null);
        return "ready";
      }
      if (!statSync(real).isFile()) return skipRow(jobId, key, rel, kind, "not a regular file");
      const size = existing.size;
      const used = usage.get(jobId) as { bytes: number };
      if (size > CHECKPOINT_FILE_BYTES || used.bytes + size > CHECKPOINT_JOB_BYTES) return skipRow(jobId, key, rel, kind, "too large");
      const id = Number(insert.run(jobId, key, rel, "modified", "ready", null, size).lastInsertRowid);
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        mkdirSync(jobDir(jobId), { recursive: true, mode: 0o700 });
        chmodSync(dir, 0o700);
        chmodSync(jobDir(jobId), 0o700);
        const copy = join(jobDir(jobId), String(id));
        copyFileSync(real, copy);
        chmodSync(copy, 0o600);
        fill.run(sha256File(copy), String(id), id);
        return "ready";
      } catch {
        rmSync(join(jobDir(jobId), String(id)), { force: true });
        mark.run("skipped", "could not copy", id);
        return "skipped";
      }
    },

    /** At the run's end: the hash of each kept file as the run left it. Files the run did not change drop out. */
    finish: (jobId: number) => finishRows(rowsOf(jobId), false),

    /** The task's files for its thread: at most 100, oldest first. A ready file whose content moved on shows as "changed". */
    view(jobId: number): CheckpointItem[] {
      return rowsOf(jobId)
        .slice(0, CHECKPOINTS_LISTED)
        .map((row) => {
          // ponytail: hashes up to 100 files per thread build; cache by size and mtime if this shows up in a profile
          const moved = row.state === "ready" && row.sha_after !== null && hashOrNull(row.path) !== row.sha_after;
          return { path: row.rel, kind: row.kind, state: moved ? "changed" : row.state, ...(row.reason ? { reason: row.reason } : {}) };
        });
    },

    /** Whether the task has any row, ready or not. */
    has: (jobId: number) => (byJob.get(jobId) as Row | undefined) !== undefined,

    /**
     * Puts files back. `roots` are the agent's grants NOW: a file outside them is refused. A file changed since the
     * run is a conflict unless `force`. Whole run: only the ready files; a second call finds nothing to do.
     */
    undo(jobId: number, roots: readonly string[], options: { path?: string; force?: boolean } = {}): UndoResult[] {
      const grantRoots = roots.map((r) => realish(r));
      const rows = rowsOf(jobId).filter((row) => (options.path === undefined ? row.state === "ready" : row.rel === options.path));
      return rows.map((row): UndoResult => {
        const out = (result: UndoOutcome, reason?: string): UndoResult => ({ path: row.rel, result, ...(reason ? { reason } : {}) });
        if (row.state === "undone") return out("skipped", "already undone");
        if (row.state === "skipped") return out("skipped", row.reason ?? "not kept");
        if (pathProblem(grantRoots, "/", row.path, true)) return out("refused", "grant revoked");
        const current = lstatOrUndefined(row.path);
        if (current && !current.isFile()) return out("refused", "not a regular file");
        const now = current ? sha256File(row.path) : null;
        if (!current) {
          if (row.kind === "created") return mark.run("undone", null, row.id), after.run(null, row.id), out("missing", "already gone");
          if (!options.force) return out("missing", "the file is gone");
        } else if (!options.force && now !== row.sha_after) return out("conflict", "changed since the run");
        try {
          if (row.kind === "created") unlinkSync(row.path);
          else restore(row, current?.mode);
        } catch (error) {
          return out("refused", isMissing(error) ? "the folder is gone" : "could not write");
        }
        mark.run("undone", null, row.id);
        after.run(row.kind === "created" ? null : row.sha_before, row.id);
        return out("restored");
      });
    },

    /** Removes the task's copies and rows. */
    drop,

    /** Startup: forgets finished tasks older than 14 days, rows of gone tasks, and folders with no row. */
    sweep(now: Date) {
      const cutoff = new Date(now.getTime() - CHECKPOINT_KEEP_DAYS * 86_400_000).toISOString();
      const stale = db
        .prepare("SELECT DISTINCT c.job_id AS id FROM checkpoints c LEFT JOIN jobs j ON j.id = c.job_id WHERE j.id IS NULL OR (j.state = 'done' AND j.ended_at < ?)")
        .all(cutoff) as { id: number }[];
      for (const { id } of stale) drop(id);
      if (!dir || !existsSync(dir)) return;
      const known = new Set((db.prepare("SELECT DISTINCT job_id AS id FROM checkpoints").all() as { id: number }[]).map((r) => String(r.id)));
      for (const name of readdirSync(dir)) if (/^\d+$/.test(name) && !known.has(name)) rmSync(join(dir, name), { recursive: true, force: true });
    },
  };

  /** Copies the snapshot beside the file, then renames it over the file (atomic), keeping the file's mode. */
  function restore(row: Row, mode: number | undefined) {
    const snap = snapPath(row);
    if (!existsSync(snap) || sha256File(snap) !== row.sha_before) throw new Error("snapshot damaged");
    const temp = join(dirname(row.path), `.atom-undo-${process.pid}-${row.id}`);
    try {
      copyFileSync(snap, temp);
      chmodSync(temp, mode !== undefined ? mode & 0o7777 : 0o644);
      renameSync(temp, row.path);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }
}
