// ADR-278: the fixture of native `improvements.get`, `improvements.set`, `improvement.fixing` and `improvement.dismiss`
// (rust/crates/ark-runtime/src/improvements.rs). Runs the TypeScript store and improver, and the `improvements` event as island.ts builds it.
// From the repository root: node rust/scripts/gen-improvements.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createImproveStore, createImprover } from "../../apps/mac/src/improve.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures", "improvements.json");
const dir = mkdtempSync(join(tmpdir(), "ark-improve-"));
const path = join(dir, "improvements.json");
const note = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "tool", title: `T ${id}`, evidence: `E ${id}`, severity: 2, why: "w", change: "c", createdAt: "2026-11-01T00:00:00.000Z", ...extra });
const seed = {
  enabled: true, lastRunAt: "2026-11-05T00:00:00.000Z", surplus: 1,
  notes: [note("n1"), note("n2", { fixStartedAt: "2026-11-02T00:00:00.000Z", severity: 3 }), note("n3", { cameBack: true, extra: "kept" })],
  dismissed: { old: "2026-10-01T00:00:00.000Z" },
  resolved: [{ id: "r1", title: "R1", how: "fixed", resolvedAt: "2026-11-03T00:00:00.000Z", createdAt: "2026-10-30T00:00:00.000Z" }],
};
writeFileSync(path, JSON.stringify(seed));
const store = createImproveStore(path);
const improver = createImprover({ store, logPath: join(dir, "none.log"), suggest: async () => "[]" } as never);
// island.ts, sendImprovements:
const view = (running: boolean) => { const s = store.read(); return { type: "improvements", enabled: s.enabled, running, ...(s.lastRunAt ? { lastRunAt: s.lastRunAt } : {}), notes: s.notes.map((n) => ({ id: n.id, title: n.title, evidence: n.evidence, severity: n.severity, why: n.why, change: n.change, fixing: Boolean(n.fixStartedAt), cameBack: n.cameBack === true })), resolved: s.resolved.map((r) => ({ id: r.id, title: r.title, how: r.how, resolvedAt: r.resolvedAt })) }; };
const file = () => JSON.parse(readFileSync(path, "utf8"));
const steps: { cmd: Record<string, unknown>; file: unknown; event: unknown }[] = [];
const step = (cmd: Record<string, unknown>, run: () => void) => { run(); steps.push({ cmd, file: file(), event: view(true) }); };
// runtime.ts, `improvements`:
const dismiss = (id: string) => { const s = store.read(); store.write({ ...s, notes: s.notes.filter((n) => n.id !== id), dismissed: { ...s.dismissed, [id]: new Date().toISOString() } }); };
const get = view(true);
step({ type: "improvement.fixing", id: "n1" }, () => improver.markFixing("n1"));
step({ type: "improvement.fixing", id: "n1" }, () => improver.markFixing("n1"));
step({ type: "improvement.fixing", id: "none" }, () => improver.markFixing("none"));
step({ type: "improvement.dismiss", id: "n3" }, () => dismiss("n3"));
step({ type: "improvement.dismiss", id: "none" }, () => dismiss("none"));
step({ type: "improvements.set", enabled: false }, () => store.write({ ...store.read(), enabled: false }));
step({ type: "improvements.set", enabled: true }, () => store.write({ ...store.read(), enabled: true }));
rmSync(dir, { recursive: true });
writeFileSync(out, `${JSON.stringify({ source: "apps/mac/src/improve.ts", seed, get, steps }, null, 1)}\n`);
console.log(steps.length, "steps");
