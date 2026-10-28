import type { DatabaseSync } from "node:sqlite";

/**
 * Audit log (docs/v2-plan.md item 9, CLAUDE.md section 16): every change the store announces, as one append-only row:
 * when, what kind, and the ids and states of the change as JSON. The change events carry ids and states only, never
 * task text, so the log holds no text of Keshab's. Noisy kinds (steps, token use, tool calls) are left out. Rows are
 * never updated or deleted.
 */

const SKIPPED = new Set(["step", "usage", "toolCall", "checkpoint", "settings"]);

export interface AuditEntry {
  id: number;
  at: Date;
  action: string;
  detail: Record<string, unknown>;
}

export function auditTable(db: DatabaseSync, now: () => Date) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL
    );
  `);
  const insert = db.prepare("INSERT INTO audit_log (at, action, detail) VALUES (?, ?, ?)");
  const newest = db.prepare("SELECT id, at, action, detail FROM audit_log ORDER BY id DESC LIMIT ?");
  return {
    /** Records a change; a failure never stops the change itself. */
    record(change: { action: string } & Record<string, unknown>): void {
      if (SKIPPED.has(change.action)) return;
      try {
        const { action, ...detail } = change;
        insert.run(now().toISOString(), action, JSON.stringify(detail));
      } catch {
        // the audit log is a record, never a reason to fail a change
      }
    },
    recent(limit: number): AuditEntry[] {
      return (newest.all(Math.max(1, Math.min(Math.trunc(limit) || 50, 500))) as { id: number; at: string; action: string; detail: string }[]).map((r) => ({
        id: r.id,
        at: new Date(r.at),
        action: r.action,
        detail: JSON.parse(r.detail) as Record<string, unknown>,
      }));
    },
  };
}
