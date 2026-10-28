import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { openHelperStore } from "./index.ts";
import { auditTable } from "./audit.ts";

// docs/v2-plan.md item 9: the audit log is append-only, holds ids and states, and skips noisy kinds.

test("the table records a change, newest first, and skips noisy kinds", () => {
  const db = new DatabaseSync(":memory:");
  let n = 0;
  const audit = auditTable(db, () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)));
  audit.record({ action: "job", job: 1, state: "running" });
  audit.record({ action: "step", job: 1, step: "searching" });
  audit.record({ action: "usage", job: 1 });
  audit.record({ action: "job", job: 1, state: "done" });
  const rows = audit.recent(10);
  assert.deepEqual(rows.map((r) => [r.action, r.detail.state]), [["job", "done"], ["job", "running"]]);
  assert.equal(rows[0]!.at.toISOString(), "2026-01-01T00:00:01.000Z");
  assert.equal(audit.recent(-5).length, 1, "the limit is at least one");
  assert.equal(audit.recent(1000).length, 2, "the limit is at most 500");
});

test("a failing insert never throws into the change", () => {
  const db = new DatabaseSync(":memory:");
  const audit = auditTable(db, () => new Date());
  db.exec("DROP TABLE audit_log");
  assert.doesNotThrow(() => audit.record({ action: "job", job: 1 }));
});

test("the store writes a row for each change it announces, with ids and states but no task text", () => {
  const store = openHelperStore({ path: ":memory:" });
  const job = store.addJob("sid", "Secret task words");
  store.start(job.id);
  const rows = store.audit(20);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((r) => !JSON.stringify(r).includes("Secret task words")));
  assert.ok(rows.some((r) => r.detail.job === job.id));
  store.close();
});
