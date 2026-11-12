// ADR-278: the fixture of native `workflow.save` and `workflow.delete` (rust/crates/ark-runtime/src/workflows.rs). Runs each call with the
// TypeScript `createWorkflowStore` and records the result and the kept list. From the repository root: node rust/scripts/gen-workflows.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkflowStore } from "../../apps/mac/src/workflows.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures", "workflows.json");
const dir = mkdtempSync(join(tmpdir(), "ark-workflows-"));
const path = join(dir, "workflows.json");
const store = createWorkflowStore(path, () => ["sid", "kame", "puff"]);
const at = "2026-11-01T00:00:00.000Z";
const flow = (over: Record<string, unknown> = {}) => ({ id: "a1", name: " Morning ", enabled: true, trigger: { kind: "manual" }, steps: [{ helper: "sid", task: " Research " }], createdAt: at, ...over });
const long = "x".repeat(2001);
type Call = { type: "save"; workflow: unknown } | { type: "delete"; id: string };
const calls: Call[] = [
  { type: "save", workflow: flow() },
  { type: "save", workflow: flow({ id: "b2", name: "Daily", trigger: { kind: "schedule", schedule: { kind: "daily", minute: 485 } }, lastRunAt: "2026-11-02T01:00:00.000Z", layout: { trigger: { x: 1.6, y: -2 }, "0": { x: 200000, y: 3 }, "5": { x: 1, y: 1 }, bad: { x: 1, y: 1 } }, extra: 1 }) },
  { type: "save", workflow: flow({ id: "c3", name: "Hourly", enabled: false, trigger: { kind: "schedule", schedule: { kind: "hours", every: 3 } }, steps: [{ helper: "kame", task: "a" }, { helper: "puff", task: "b" }] }) },
  { type: "save", workflow: flow({ id: "d4", name: "Event", trigger: { kind: "event", event: "task.failed" } }) },
  { type: "save", workflow: flow({ name: "Renamed", enabled: false }) },
  { type: "save", workflow: flow({ id: "BAD ID!", name: "Fresh id" }) },
  { type: "save", workflow: flow({ trigger: undefined }) },
  { type: "save", workflow: flow({ trigger: { kind: "nope" } }) },
  { type: "save", workflow: flow({ trigger: { kind: "schedule", schedule: { kind: "weekly", weekday: 9, minute: 1 } } }) },
  { type: "save", workflow: flow({ trigger: { kind: "event", event: "x" } }) },
  { type: "save", workflow: flow({ steps: [] }) },
  { type: "save", workflow: flow({ steps: Array.from({ length: 9 }, () => ({ helper: "sid", task: "t" })) }) },
  { type: "save", workflow: flow({ steps: ["no"] }) },
  { type: "save", workflow: flow({ steps: [{ helper: "ghost", task: "t" }] }) },
  { type: "save", workflow: flow({ steps: [{ helper: "sid", task: "  " }] }) },
  { type: "save", workflow: flow({ steps: [{ helper: "sid", task: long }] }) },
  { type: "save", workflow: flow({ name: "  " }) },
  { type: "save", workflow: flow({ name: "n".repeat(81) }) },
  { type: "delete", id: "b2" },
  { type: "delete", id: "nothing" },
];
const results = calls.map((c) => {
  try { if (c.type === "save") store.save(c.workflow); else store.remove(c.id); return { ok: true }; } catch (e) { return { ok: false, error: (e as Error).message }; }
});
const kept = (JSON.parse(readFileSync(path, "utf8")) as { workflows: Record<string, unknown>[] }).workflows;
rmSync(dir, { recursive: true });
// Save more than 20 in a second store: the limit.
const dir2 = mkdtempSync(join(tmpdir(), "ark-workflows-"));
const big = createWorkflowStore(join(dir2, "w.json"), () => ["sid"]);
let limit = "";
for (let i = 0; i < 21; i++) { try { big.save(flow({ id: `w${i}`, name: `W${i}` })); } catch (e) { limit = (e as Error).message; } }
rmSync(dir2, { recursive: true });
const calls2 = calls.map((c) => (c.type === "save" ? { type: "workflow.save", workflow: c.workflow } : { type: "workflow.delete", id: c.id }));
writeFileSync(out, `${JSON.stringify({ source: "apps/mac/src/workflows.ts", calls: calls2, results, kept, limit }, null, 1)}\n`);
console.log(results.map((r) => (r.ok ? "ok" : "refused")).join(" "), "|", limit);
