// ADR-278: the fixture of native `brief.set` and a brief with no sources (rust/crates/ark-runtime/src/brief.rs). Runs the TypeScript store and runner.
// From the repository root: node rust/scripts/gen-brief.ts
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openBriefs } from "../../services/memory/src/briefs.ts";
import { createBriefRunner } from "../../apps/mac/src/brief.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures", "brief.json");
const now = new Date("2026-11-13T05:00:00.000Z");
const briefs = openBriefs(new DatabaseSync(":memory:"), () => now);
const changes: unknown[] = [
  { enabled: true, minute: 90 }, { minute: 1440 }, { minute: -1 }, { spoken: "yes" }, { preparationDailyLimit: 9 }, { preparationDailyLimit: 3 },
  { preparationNoteIds: [3, 4] }, { preparationNoteIds: [3, 3] }, { preparationNoteIds: [0] }, { preparation: true }, { telegram: true },
];
const steps = changes.map((change) => {
  let error: string | undefined;
  try { briefs.update(change as never); } catch (e) { error = (e as Error).message; }
  return { change, ...(error ? { error } : {}), settings: briefs.settings() };
});
const runner = createBriefRunner({ briefs, sources: {}, write: async () => ["x"], now: () => now, timeZone: "UTC" });
const saved = await runner.run("manual");
const prepared = openBriefs(new DatabaseSync(":memory:"), () => now);
prepared.update({ preparation: true });
const runner2 = createBriefRunner({ briefs: prepared, sources: {}, write: async () => ["x"], now: () => now, timeZone: "UTC" });
const savedPrepared = await runner2.run("manual");
writeFileSync(out, JSON.stringify({ steps, saved: { lines: saved.lines, source: saved.source }, savedPrepared: { lines: savedPrepared.lines, source: savedPrepared.source, preparation: savedPrepared.preparation } }, null, 1));
console.log("wrote", out);
