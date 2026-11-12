// ADR-278 Phase 4: the fixture of the native helper writes (rust/crates/ark-runtime/src/helpers_write.rs). Runs each write on a copy of the
// helper fixture with the TypeScript store and records the tables after it. Run `node rust/scripts/gen-helpers.ts` first, then from the
// repository root: node rust/scripts/gen-helpers-writes.ts
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openHelperStore } from "../../services/helpers/src/store.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures");
const src = join(fixtures, "helpers");
const out = join(fixtures, "helpers-writes");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const open = (dir: string) => openHelperStore({ path: join(dir, "helpers.db"), agentsDir: join(dir, "agents"), home: "/private/tmp/ark-helpers-fixture-home" });

// The base: the fixture after the store opened it once (its start-up repairs are in the file).
const base = join(out, "base");
cpSync(src, base, { recursive: true });
rmSync(join(base, "expected.json"));
open(base).close();
for (const ext of ["-wal", "-shm"]) rmSync(join(base, `helpers.db${ext}`), { force: true });

const dump = (dir: string) => {
  const db = new DatabaseSync(join(dir, "helpers.db"));
  const all = (sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));
  const result = {
    jobs: all("SELECT * FROM jobs ORDER BY id"),
    labels: all("SELECT * FROM job_labels ORDER BY job_id, label"),
    blockers: all("SELECT * FROM job_blockers ORDER BY job_id, blocker_id"),
    events: all("SELECT job_id, kind FROM job_events ORDER BY id"),
    comments: all("SELECT job_id FROM job_comments ORDER BY id"),
    reports: all("SELECT job_id FROM reports ORDER BY job_id"),
    planJobs: all("SELECT * FROM plan_jobs ORDER BY plan_id, n"),
    audit: all("SELECT action, detail FROM audit_log ORDER BY id").map((r: { action: string; detail: string }) => ({ action: r.action, detail: JSON.parse(r.detail) })),
  };
  db.close();
  return result;
};

type Step = { cmd: Record<string, unknown>; run: (s: ReturnType<typeof open>) => unknown };
type Op = { name: string; steps: Step[]; forward?: boolean };
const add = (id: number, label: string): Step => ({ cmd: { type: "job.label.add", id, label }, run: (s) => s.addLabel(id, label) });
const drop = (id: number, label: string): Step => ({ cmd: { type: "job.label.remove", id, label }, run: (s) => s.removeLabel(id, label) });
const block = (id: number, blockedBy: number[]): Step => ({ cmd: { type: "job.block", id, blockedBy }, run: (s) => s.setBlockers(id, blockedBy) });
const del = (id: number): Step => ({ cmd: { type: "job.delete", id }, run: (s) => s.remove(id) });
// Tasks after the store opened the file: 1, 2, 4, 7, 10 queued; 8 and 11 done; 3, 5, 9 failed; 6 stopped.
const ops: Op[] = [
  { name: "label add", steps: [add(1, "  New   Label ")] },
  { name: "label add existing", steps: [add(1, "alpha")] },
  { name: "label add bad", steps: [add(1, "No!")] },
  { name: "label add unknown task", steps: [add(999, "x")] },
  { name: "label add the seventh", steps: ["a", "b", "c", "d", "e", "f", "g"].map((l) => add(2, l)) },
  { name: "label remove", steps: [drop(1, " Research")] },
  { name: "label remove missing", steps: [drop(1, "nope")] },
  { name: "block", steps: [block(1, [8, 11, 8])] },
  { name: "block again and clear", steps: [block(1, [8]), block(1, [])] },
  { name: "block circle", steps: [block(2, [1]), block(1, [2])] },
  { name: "block self", steps: [block(1, [1])] },
  { name: "block on a failed task", steps: [block(1, [3])] },
  { name: "block on an unknown task", steps: [block(1, [999])] },
  { name: "block a finished task", steps: [block(8, [11])] },
  { name: "delete finished", steps: [del(8)] },
  { name: "delete failed", steps: [del(9)] },
  { name: "delete stopped after blocking on it", steps: [block(1, [11]), del(11)] },
  { name: "delete queued goes to Node", steps: [del(4)], forward: true },
];
const cases = ops.map((op, i) => {
  const dir = join(out, `case${i}`);
  cpSync(base, dir, { recursive: true });
  const store = open(dir);
  const outcomes = op.steps.map((step) => {
    try { step.run(store); return "done"; } catch (error) { return error instanceof Error ? `refused: ${error.message}` : "refused"; }
  });
  store.close();
  for (const ext of ["-wal", "-shm"]) rmSync(join(dir, `helpers.db${ext}`), { force: true });
  const after = op.forward ? undefined : dump(dir);
  rmSync(dir, { recursive: true });
  return { name: op.name, cmds: op.steps.map((s) => s.cmd), outcomes: op.forward ? ["forward"] : outcomes, ...(after ? { after } : {}) };
});
rmSync(join(base, "agents", "none"), { force: true });
const before = dump(base);
writeFileSync(join(out, "expected.json"), `${JSON.stringify({ source: "services/helpers/src/store.ts", before, cases }, null, 1)}\n`);
console.log(`helpers-writes: ${cases.map((c) => `${c.name}=${c.outcomes.at(-1)}`).join(", ")}`);
