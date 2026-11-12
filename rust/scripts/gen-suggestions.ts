// ADR-278: the fixture of native `suggestions.deny` and `suggestions.set` (rust/crates/ark-runtime/src/suggestions.rs). Runs the TypeScript
// `openSuggestions` and records the tables after each call. From the repository root: node rust/scripts/gen-suggestions.ts
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openSuggestions } from "../../services/memory/src/suggestions.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures", "suggestions.json");
const db = new DatabaseSync(":memory:");
const store = { add: () => { throw new Error("unused"); }, recent: () => [], count: () => 0, get: () => undefined, remove: () => false } as never;
const s = openSuggestions(db, store, () => new Date("2026-11-10T00:00:00.000Z"));
s.suggest(["Likes  tea.", "Lives in Oslo..", "Prefers dark   mode", "Fourth one"], "chat-1");
const all = (sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));
const tables = () => ({ suggestions: all("SELECT id, text, hash, chat_id, created_at FROM fact_suggestions ORDER BY id"), denied: all("SELECT hash FROM denied_facts ORDER BY hash"), enabled: s.enabled() });
const seed = tables();
const steps: { cmd: Record<string, unknown>; result: unknown; after: ReturnType<typeof tables> }[] = [];
const step = (cmd: Record<string, unknown>, run: () => unknown) => { const result = run(); steps.push({ cmd, result, after: tables() }); };
step({ type: "suggestions.deny", id: 2 }, () => s.deny(2));
step({ type: "suggestions.deny", id: 2 }, () => s.deny(2));
step({ type: "suggestions.deny", id: 99 }, () => s.deny(99));
step({ type: "suggestions.set", enabled: false }, () => s.setEnabled(false));
step({ type: "suggestions.set", enabled: true }, () => s.setEnabled(true));
step({ type: "suggestions.deny", id: 3 }, () => s.deny(3));
writeFileSync(out, `${JSON.stringify({ source: "services/memory/src/suggestions.ts", seed, steps }, null, 1)}\n`);
console.log(seed.suggestions.map((r: { hash: string }) => r.hash.slice(0, 6)).join(" "), steps.map((x) => x.result).join(","));
