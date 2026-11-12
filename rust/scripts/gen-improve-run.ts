// ADR-278: the fixture of native `improvements.run` (rust/crates/ark-runtime/src/improve_run.rs). Runs the TypeScript improver on a made-up
// log, a seed state and a fixed answer of the model. From the repository root: node rust/scripts/gen-improve-run.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createImproveStore, createImprover, normalizeReason } from "../../apps/mac/src/improve.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures", "improve-run.json");
const now = new Date("2026-11-13T00:00:00.000Z");
const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
const lines: string[] = [];
const add = (hoursAgo: number, fields: Record<string, unknown>) => lines.push(JSON.stringify({ time: at(hoursAgo), ...fields }));
for (let i = 0; i < 12; i += 1) add(1 + i, { event: "tool.call", name: "web_search", ok: i >= 4 });
for (let i = 0; i < 4; i += 1) add(2 + i, { event: "computer.action", ok: false, reason: `Could not find "Save ${i}" at /Users/someone/Docs/file${i}.txt after ${i + 10} tries` });
for (let i = 0; i < 3; i += 1) add(3 + i, { event: "island.runtime.exit", code: 1, requested: false });
for (let i = 0; i < 52; i += 1) add(5, { event: "api.unauthorized" });
for (let i = 0; i < 21; i += 1) add(6, { event: "memory.slow", level: "warn", message: `took ${i} ms in /tmp/x${i}` });
for (let i = 0; i < 12; i += 1) add(7 + i, { event: "turn.complete", modelMs: 16_000 + i * 100 });
for (let i = 0; i < 5; i += 1) add(8 + i, { event: "turn.end", outcome: i < 4 ? "stopped" : "done" });
for (let i = 0; i < 3; i += 1) add(9, { event: "session.over_budget" });
add(24 * 20, { event: "tool.call", name: "web_search", ok: false });
lines.push("not json");
const seed = {
  enabled: true, lastRunAt: "2026-11-01T00:00:00.000Z",
  notes: [
    { id: "tool:old-tool", kind: "tool", title: "Old", evidence: "e", severity: 2, why: "w", change: "c", createdAt: "2026-11-01T00:00:00.000Z" },
    { id: "slow:turns", kind: "slow", title: "Some answers are slow", evidence: "e", severity: 1, why: "keep why", change: "keep change", createdAt: "2026-11-02T00:00:00.000Z", fixStartedAt: "2026-11-12T00:00:00.000Z" },
  ],
  dismissed: { "unauthorized:api": "2026-11-10T00:00:00.000Z" },
  resolved: [{ id: "crash:1", title: "Crash", how: "fixed", resolvedAt: "2026-11-10T00:00:00.000Z", createdAt: "2026-11-01T00:00:00.000Z" }],
};
const answer = 'Here you go: [{"id":"tool:web-search","why":"Searches   fail.","change":"Retry   once."},{"id":"nope","why":"x","change":"y"},{"id":"computer:could-not-find-save-at-after-tries","why":"Buttons move.","change":"Wait for the window."}] done';
const dir = mkdtempSync(join(tmpdir(), "ark-improve-run-"));
const path = join(dir, "improvements.json");
writeFileSync(path, JSON.stringify(seed));
const store = createImproveStore(path);
const asked: string[] = [];
const improver = createImprover({ store, logPath: "/none", now: () => now, readLines: () => lines, suggest: async (findings) => { asked.push(JSON.stringify(findings.map((f) => ({ id: f.id, title: f.title, evidence: f.evidence, severity: f.severity })))); return answer; } });
await improver.run({ force: true });
const after = JSON.parse(readFileSync(path, "utf8"));
rmSync(dir, { recursive: true });
const reasons = ['Could not open "a file" at /Users/me/x y', "see /private/var/foo,bar 12 and 'q' 34   gaps", "x".repeat(120), "/tmp/ ok"];
writeFileSync(out, JSON.stringify({ now: now.toISOString(), lines, seed, answer, asked, after, reasons: reasons.map((r) => [r, normalizeReason(r)]) }, null, 1));
console.log("wrote", out);
