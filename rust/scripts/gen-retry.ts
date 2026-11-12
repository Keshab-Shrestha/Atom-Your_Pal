// ADR-278 Phase 4: the fixture of the native retry plans (rust/crates/ark-runtime/src/helpers_retry.rs). Runs each step with the
// TypeScript store on a copy of the helper-writes base and records the tables after it. Run `node rust/scripts/gen-helpers-writes.ts` first,
// then from the repository root: node rust/scripts/gen-retry.ts
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openHelperStore } from "../../services/helpers/src/store.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures");
const base = join(fixtures, "helpers-writes", "base");
const out = join(fixtures, "retry");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const open = (dir: string) => openHelperStore({ path: join(dir, "helpers.db"), agentsDir: join(dir, "agents"), home: "/private/tmp/ark-helpers-fixture-home" });

const dump = (dir: string) => {
  const db = new DatabaseSync(join(dir, "helpers.db"));
  const all = (sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));
  const result = {
    jobs: all("SELECT * FROM jobs ORDER BY id").map((j: { id: number; created_at: string; ended_at: string | null }) => (j.id > 11 ? { ...j, created_at: "<new>", ended_at: j.ended_at ? "<new>" : null } : j)),
    events: all("SELECT job_id, kind FROM job_events ORDER BY id"),
    audit: all("SELECT action, detail FROM audit_log ORDER BY id").map((r: { action: string; detail: string }) => ({ action: r.action, detail: (({ ms, ...rest }) => (ms !== undefined ? { ...rest, ms: "<ms>" } : rest))(JSON.parse(r.detail)) })), // the time a task lived is the clock of the moment
  };
  db.close();
  return result;
};
type Store = ReturnType<typeof open>;
type Step = { op: string; id: number; reason?: string; run: (s: Store) => unknown };
const retry = (id: number): Step => ({ op: "retry", id, run: (s) => { const r = s.queueNativeRetry(id); return { job: r.job.id, created: r.created }; } });
const fail = (id: number, reason: string): Step => ({ op: "fail", id, reason, run: (s) => s.failQueuedRetry(id, reason) });
const drop = (id: number): Step => ({ op: "remove", id, run: (s) => s.remove(id) });
// Tasks: 1, 2, 4, 7, 10 queued; 8 and 11 done; 3, 5, 9 failed; 6 stopped (already retried as 9). 3 and 5 sit in workflow plans.
const ops: { name: string; steps: Step[] }[] = [
  { name: "retry a failed task", steps: [retry(9)] },
  { name: "retry twice gives the same attempt", steps: [retry(9), retry(9)] },
  { name: "retry an already retried task", steps: [retry(6)] },
  { name: "retry a done task", steps: [retry(8)] },
  { name: "retry a queued task", steps: [retry(1)] },
  { name: "retry an unknown task", steps: [retry(999)] },
  { name: "retry a retry that is still queued", steps: [retry(9), retry(12)] },
  { name: "a retry that cannot start fails", steps: [retry(9), fail(12, "The turn could not start.")] },
  { name: "a retry that failed can be retried again", steps: [retry(9), fail(12, "The turn could not start."), retry(12)] },
  { name: "fail a queued task that is no retry", steps: [fail(1, "x")] },
  { name: "retry after the attempt was removed", steps: [retry(9), drop(12), retry(9)] },
  { name: "retry a workflow task goes to Node", steps: [retry(3)] },
  { name: "retry a workflow task of another plan goes to Node", steps: [retry(5)] },
];
const cases = ops.map((op, i) => {
  const dir = join(out, `case${i}`);
  cpSync(base, dir, { recursive: true });
  const store = open(dir);
  const outcomes = op.steps.map((step) => {
    try { return { done: step.run(store) ?? null }; } catch (error) { return { refused: error instanceof Error ? error.message : "refused" }; }
  });
  store.close();
  for (const ext of ["-wal", "-shm"]) rmSync(join(dir, `helpers.db${ext}`), { force: true });
  const after = dump(dir);
  rmSync(dir, { recursive: true });
  return { name: op.name, steps: op.steps.map(({ op, id, reason }) => ({ op, id, ...(reason ? { reason } : {}) })), outcomes, after };
});
writeFileSync(join(out, "expected.json"), `${JSON.stringify({ source: "services/helpers/src/store.ts", before: (() => { const d = join(out, "b"); cpSync(base, d, { recursive: true }); const r = dump(d); rmSync(d, { recursive: true }); return r; })(), cases }, null, 1)}\n`);
console.log(cases.map((c) => `${c.name}=${JSON.stringify(c.outcomes.at(-1))}`).join("\n"));
