import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fileVerificationSummary, verificationInput, type TaskVerification, type TaskVerificationInput } from "./file-checks.ts";

/** Host observations only. Neither a worker report nor exit zero proves a natural-language task criterion. */
export interface RevisionObservation { state: "clean" | "dirty" | "unavailable"; head?: string }
export interface TaskInspectionInput {
  id: string;
  attempt: string;
  utility: string;
  commandDigest: string;
  workspaceDigest: string;
  exitCode: number | null;
  before: RevisionObservation;
  after: RevisionObservation;
}
export interface TaskInspection extends TaskInspectionInput {
  schema: "atom.task-inspection/v1";
  kind: "host-project-inspection";
  at: string;
  /** Clean tracked project subtree at both observations; not a continuous snapshot or current verification. */
  revision?: string;
}
export type TaskAttemptState = "running" | "reported" | "failed" | "stopped" | "interrupted";
export interface TaskEvidence {
  attempt: string;
  state: TaskAttemptState;
  startedAt: string;
  endedAt?: string;
  inspections: TaskInspection[];
  inspectionCount: number;
  unavailableInspections?: number;
  verification?: TaskVerification;
  verificationUnavailable?: boolean;
}
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const revision = (r: RevisionObservation): RevisionObservation | undefined => {
  if (!r || !["clean", "dirty", "unavailable"].includes(r.state)) return;
  if (r.state === "unavailable") return { state: "unavailable" };
  if (typeof r.head !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(r.head)) return;
  return { state: r.state, head: r.head };
};
const validInput = (input: TaskInspectionInput): boolean => Boolean(input && typeof input.id === "string" && UUID.test(input.id)
  && typeof input.attempt === "string" && UUID.test(input.attempt)
  && ["pwd", "ls", "cat", "wc", "head", "tail", "grep"].includes(input.utility)
  && typeof input.commandDigest === "string" && SHA256.test(input.commandDigest)
  && typeof input.workspaceDigest === "string" && SHA256.test(input.workspaceDigest)
  && (input.exitCode === null || Number.isSafeInteger(input.exitCode) && Math.abs(input.exitCode) <= 65535));
const boundRevision = (before: RevisionObservation, after: RevisionObservation): string | undefined =>
  before.state === "clean" && after.state === "clean" && before.head === after.head ? before.head : undefined;

function decodeReceipt(raw: string, attempt: string): TaskInspection | undefined {
  try {
    if (Buffer.byteLength(raw) > 4096) return;
    const r = JSON.parse(raw) as TaskInspection;
    if (r.schema !== "atom.task-inspection/v1" || r.kind !== "host-project-inspection" || r.attempt !== attempt || !validInput(r)
      || typeof r.at !== "string" || new Date(r.at).toISOString() !== r.at) return;
    const before = revision(r.before), after = revision(r.after);
    if (!before || !after || r.revision !== boundRevision(before, after)) return;
    // Reconstruct the closed payload; unknown fields can never become UI/model-facing evidence.
    return { schema: r.schema, kind: r.kind, id: r.id, attempt, utility: r.utility, at: r.at, commandDigest: r.commandDigest,
      workspaceDigest: r.workspaceDigest, exitCode: r.exitCode, before, after, ...(r.revision ? { revision: r.revision } : {}) };
  } catch { return; }
}

function decodeVerification(raw: string, attempt: string): TaskVerification | undefined {
  try {
    if (Buffer.byteLength(raw) > 4096) return;
    const value = JSON.parse(raw) as TaskVerification;
    const checked = verificationInput(value);
    if (!checked || checked.attempt !== attempt || value.schema !== "atom.task-verification/v1" || value.kind !== "host-file-predicates"
      || typeof value.at !== "string" || new Date(value.at).toISOString() !== value.at) return;
    return { ...checked, schema: "atom.task-verification/v1", kind: "host-file-predicates", at: value.at };
  } catch { return; }
}

/** Additive tables in the helper database. No prompts, paths, argv, output or model-declared check results. */
export function taskEvidenceTable(db: DatabaseSync, opened: Date) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_attempts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, job_id INTEGER NOT NULL,
      state TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS task_attempts_job ON task_attempts(job_id, seq);
    CREATE UNIQUE INDEX IF NOT EXISTS task_attempts_running ON task_attempts(job_id) WHERE state = 'running';
    CREATE TABLE IF NOT EXISTS task_inspections (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, attempt_id TEXT NOT NULL,
      receipt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS task_inspections_attempt ON task_inspections(attempt_id, seq);
    CREATE TABLE IF NOT EXISTS task_verifications (
      id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE, receipt TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS task_evidence_deleted AFTER DELETE ON jobs BEGIN
      DELETE FROM task_inspections WHERE attempt_id IN (SELECT id FROM task_attempts WHERE job_id = old.id);
      DELETE FROM task_attempts WHERE job_id = old.id;
    END;
  `);
  db.exec(`CREATE TRIGGER IF NOT EXISTS task_verification_deleted AFTER DELETE ON task_attempts BEGIN
    DELETE FROM task_verifications WHERE attempt_id = old.id;
  END;`);
  db.prepare("UPDATE task_attempts SET state = 'interrupted', ended_at = ? WHERE state = 'running'").run(opened.toISOString());
  const latest = db.prepare("SELECT * FROM task_attempts WHERE job_id = ? ORDER BY seq DESC LIMIT 1");
  const begin = db.prepare("INSERT INTO task_attempts(id, job_id, state, started_at) VALUES (?, ?, 'running', ?)");
  const end = db.prepare("UPDATE task_attempts SET state = ?, ended_at = ? WHERE job_id = ? AND state = 'running'");
  const insert = db.prepare("INSERT OR IGNORE INTO task_inspections(id, attempt_id, receipt) VALUES (?, ?, ?)");
  const receipts = db.prepare("SELECT receipt FROM task_inspections WHERE attempt_id = ? ORDER BY seq DESC LIMIT 12");
  const count = db.prepare("SELECT COUNT(*) AS n FROM task_inspections WHERE attempt_id = ?");
  const verified = db.prepare("SELECT receipt FROM task_verifications WHERE attempt_id = ?");
  const saveVerification = db.prepare("INSERT OR IGNORE INTO task_verifications(id, attempt_id, receipt) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM task_attempts a JOIN jobs j ON j.id = a.job_id WHERE a.id = ? AND a.job_id = ? AND a.state = 'running' AND j.state = 'running')");
  type Row = { id: string; state: TaskAttemptState; started_at: string; ended_at: string | null };
  return {
    /** Recovery projections need only the latest state, never report text or full receipt decoding. */
    stateOf(job: number): TaskAttemptState | undefined {
      const row = latest.get(job) as Row | undefined;
      if (row && UUID.test(row.id) && ["running", "reported", "failed", "stopped", "interrupted"].includes(row.state)) return row.state;
    },
    transition(job: number, state: string, at: Date) {
      if (state === "running") begin.run(randomUUID(), job, at.toISOString());
      else if (["done", "failed", "stopped", "interrupted"].includes(state)) end.run(state === "done" ? "reported" : state, at.toISOString(), job);
    },
    record(job: number, input: TaskInspectionInput, at: Date): boolean {
      if (!validInput(input)) return false;
      const row = latest.get(job) as Row | undefined;
      if (row?.state !== "running" || row.id !== input.attempt || (count.get(row.id) as { n: number }).n >= 64) return false;
      const before = revision(input.before), after = revision(input.after);
      if (!before || !after) return false;
      const receipt: TaskInspection = { schema: "atom.task-inspection/v1", id: input.id, attempt: row.id, kind: "host-project-inspection", at: at.toISOString(),
        utility: input.utility, commandDigest: input.commandDigest, workspaceDigest: input.workspaceDigest, exitCode: input.exitCode, before, after,
        ...(boundRevision(before, after) ? { revision: boundRevision(before, after) } : {}) };
      return Number(insert.run(receipt.id, row.id, JSON.stringify(receipt)).changes) > 0;
    },
    recordVerification(job: number, input: TaskVerificationInput, at: Date): boolean {
      const checked = verificationInput(input);
      if (!checked) return false;
      const row = latest.get(job) as Row | undefined;
      if (row?.state !== "running" || row.id !== checked.attempt) return false;
      const receipt: TaskVerification = { ...checked, schema: "atom.task-verification/v1", kind: "host-file-predicates", at: at.toISOString() };
      return Number(saveVerification.run(receipt.id, row.id, JSON.stringify(receipt), row.id, job).changes) > 0;
    },
    of(job: number): TaskEvidence | undefined {
      const row = latest.get(job) as Row | undefined;
      if (!row || !UUID.test(row.id) || !["running", "reported", "failed", "stopped", "interrupted"].includes(row.state)) return;
      const stored = receipts.all(row.id) as { receipt: string }[];
      const inspections = stored.reverse().flatMap((r) => decodeReceipt(r.receipt, row.id) ?? []);
      const unavailable = stored.length - inspections.length;
      const verificationRow = verified.get(row.id) as { receipt: string } | undefined;
      const verification = verificationRow && decodeVerification(verificationRow.receipt, row.id);
      return { attempt: row.id, state: row.state, startedAt: row.started_at, ...(row.ended_at ? { endedAt: row.ended_at } : {}),
        inspectionCount: (count.get(row.id) as { n: number }).n,
        inspections, ...(unavailable ? { unavailableInspections: unavailable } : {}),
        ...(verification ? { verification } : verificationRow ? { verificationUnavailable: true } : {}) };
    },
  };
}

export function taskEvidenceText(evidence: TaskEvidence, detail = false): string {
  const lines = [`ATOM attempt ${evidence.attempt}: ${evidence.state}; ${evidence.inspectionCount} host inspection receipt(s). ` +
    (evidence.verification ? fileVerificationSummary(evidence.verification.checks) : evidence.verificationUnavailable ? "The host file-predicate receipt is unreadable; no matched result is inferred." : "No independent file-predicate verification is recorded.")];
  if (detail) {
    lines.push(`Showing ${evidence.inspections.length} readable receipt(s) from the newest twelve; ${evidence.inspectionCount} total recorded.${evidence.unavailableInspections ? ` ${evidence.unavailableInspections} receipt(s) are unavailable or unsupported.` : ""}`);
    for (const receipt of evidence.inspections) lines.push(`${receipt.utility} inspection ${receipt.id}: ${receipt.exitCode === null ? "exit not observed; dispatch/result unconfirmed" : `exit ${receipt.exitCode}`}; ${receipt.revision ? `clean source revision ${receipt.revision} at both boundary reads` : "revision not bound (dirty, changed or unavailable)"}.`);
    lines.push("These are historical, read-only project inspections, not test passes. Later edits can invalidate their relevance; ignored files, submodule contents and the dependency environment are not attested.");
    if (evidence.verification) {
      const v = evidence.verification;
      lines.push(`Host file-predicate receipt ${v.id}, observed ${v.at}; manifest ${v.manifestDigest}; workspace digest ${v.workspaceDigest}.`);
      for (const c of v.checks) lines.push(`C${c.n}: ${c.state} (${c.reason})${c.snapshot ? `; complete bounded file snapshot ${c.snapshot}` : ""}.`);
      lines.push("Each predicate describes its read-time file snapshot only. Later edits, source-project handoff, runtime behavior and arbitrary natural-language criteria are not verified; no test or project code was executed by this collector.");
    }
  }
  return lines.join("\n");
}

export function taskEvidenceSummary(evidence: TaskEvidence): string {
  const state: Record<TaskAttemptState, string> = { running: "Work is in progress.", reported: "The worker returned a report.", failed: "This attempt failed.", stopped: "The task was stopped; effects may remain.", interrupted: "The attempt was interrupted; its result is unconfirmed." };
  return `${state[evidence.state]} ATOM recorded ${evidence.inspectionCount} inspection record${evidence.inspectionCount === 1 ? "" : "s"}.${evidence.unavailableInspections ? " Some records are unavailable." : ""} `
    + (evidence.verification ? fileVerificationSummary(evidence.verification.checks) : evidence.verificationUnavailable ? "The file-check receipt is unavailable; whole-task correctness is unverified." : "No independent file-predicate verification is recorded; whole-task correctness is unverified.");
}
