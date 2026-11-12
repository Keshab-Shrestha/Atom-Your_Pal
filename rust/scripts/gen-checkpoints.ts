// ADR-278 Phase 4: the fixture of the native undo (rust/crates/ark-runtime/src/helpers_checkpoints.rs). Makes file copies with the
// TypeScript checkpoints, changes some files, undoes with the TypeScript and records results, files and rows.
// From the repository root: node rust/scripts/gen-checkpoints.ts
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { checkpointTable } from "../../services/helpers/src/checkpoints.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures", "checkpoints");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "base", "work"), { recursive: true });
const base = realpathSync(join(out, "base"));
const work = join(base, "work");
const home = "/private/tmp/ark-checkpoints-fixture-home";

const db = new DatabaseSync(join(base, "checkpoints.db"));
const ck = checkpointTable(db, join(base, "copies"), home);
const edit = (job: number, name: string, before: string | undefined, after: string | undefined) => {
  const p = join(work, name);
  if (before !== undefined) writeFileSync(p, before);
  ck.capture(job, [work], p);
  if (after === undefined) unlinkSync(p); else writeFileSync(p, after);
};
edit(1, "a.txt", "a old", "a new");
edit(1, "b.txt", "b old", "b old"); // not changed: the row drops out
edit(1, "c.txt", undefined, "c made");
edit(1, "d.txt", "d old", "d new");
edit(1, "e.txt", undefined, "e made");
edit(1, "f.txt", "f old", "f new");
chmodSync(join(work, "a.txt"), 0o755);
ck.finish(1);
writeFileSync(join(work, "d.txt"), "d changed by Keshab"); // after the run: a conflict
unlinkSync(join(work, "e.txt")); // a created file that is already gone
unlinkSync(join(work, "f.txt")); // a modified file that is gone
db.close();
for (const ext of ["-wal", "-shm"]) rmSync(join(base, `checkpoints.db${ext}`), { force: true });

const state = (dir: string) => {
  const d = new DatabaseSync(join(dir, "checkpoints.db"));
  const rows = JSON.parse(JSON.stringify(d.prepare("SELECT job_id, rel, kind, state, reason, sha_before, sha_after FROM checkpoints ORDER BY id").all()));
  d.close();
  const files: Record<string, string | null> = {};
  for (const n of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt"]) files[n] = existsSync(join(dir, "work", n)) ? readFileSync(join(dir, "work", n), "utf8") : null;
  const leftovers = readdirSync(join(dir, "work")).filter((n) => n.startsWith(".ark-undo"));
  return { rows, files, leftovers };
};
type Scenario = { name: string; roots: string[]; path?: string; force?: boolean };
const scenarios: Scenario[] = [
  { name: "whole run", roots: [work] },
  { name: "whole run, forced", roots: [work], force: true },
  { name: "one file", roots: [work], path: "a.txt" },
  { name: "conflict", roots: [work], path: "d.txt" },
  { name: "conflict, forced", roots: [work], path: "d.txt", force: true },
  { name: "created file already gone", roots: [work], path: "e.txt" },
  { name: "modified file gone", roots: [work], path: "f.txt" },
  { name: "modified file gone, forced", roots: [work], path: "f.txt", force: true },
  { name: "grant revoked", roots: [join(base, "elsewhere")] },
  { name: "unknown path", roots: [work], path: "nope.txt" },
];
const cases = scenarios.map((s, i) => {
  const dir = join(out, `case${i}`);
  cpSync(base, dir, { recursive: true });
  const d = new DatabaseSync(join(dir, "checkpoints.db"));
  const t = checkpointTable(d, join(dir, "copies"), home);
  // The rows hold the base folder in their paths: point them at this copy.
  d.exec(`UPDATE checkpoints SET path = replace(path, '${base}', '${dir}')`);
  const results = t.undo(1, s.roots.map((r) => r.replace(base, dir)), { ...(s.path ? { path: s.path } : {}), ...(s.force ? { force: true } : {}) });
  d.close();
  const after = state(dir);
  rmSync(dir, { recursive: true });
  return { ...s, results, after };
});
writeFileSync(join(out, "expected.json"), `${JSON.stringify({ source: "services/helpers/src/checkpoints.ts", base, before: state(base), cases }, null, 1)}\n`);
console.log(cases.map((c) => `${c.name}=${c.results.map((r: { result: string }) => r.result).join("/")}`).join(", "));
