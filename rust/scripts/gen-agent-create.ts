// ADR-278: the fixture of native `agent.create` (rust/crates/ark-runtime/src/helpers_agent_create.rs). Runs each create on a copy of the
// helpers-writes base with the TypeScript store and records the result of each call and the final files and rows.
// From the repository root: node rust/scripts/gen-agent-create.ts
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openHelperStore } from "../../services/helpers/src/store.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures");
const dir = mkdtempSync(join(tmpdir(), "ark-agent-create-"));
cpSync(join(fixtures, "helpers-writes", "base"), dir, { recursive: true });
const store = openHelperStore({ path: join(dir, "helpers.db"), agentsDir: join(dir, "agents"), home: "/private/tmp/ark-helpers-fixture-home" });
type Kit = "research" | "folders" | "think";
const input = (name: string, role: string, kit: string, personality = "Curious.", howItWorks = "", rules = "") => ({ name, role, kit, personality, howItWorks, rules });
const inputs = [
  input("Scout Fox", " Web  Researcher ", "research", " Curious\r\nand kind ", "Reads first.", "## not a heading\n\\## kept\nplain"),
  input("Scout fox", "coder", "folders"),
  input("Zed", "analyst", "think"),
  input("Zed-", "analyst", "think", "Calm."),
  input("O'Neil Ann", "Note-taker", "folders", "Quiet.", "Writes.", ""),
  input("Tin", "improver", "think"),
  input("Pat", "r2d2", "think"),
  input("Pat", "reviewer", "wizard"),
  input("Ark", "reviewer", "think"),
  input("Plan", "reviewer", "think"),
  input("Fork", "reviewer", "think"),
  input("7up", "reviewer", "think"),
  input("Empty", "reviewer", "think", "   "),
];
const outcome = (i: ReturnType<typeof input>) => {
  try { return { ok: true, id: store.createAgent(i as Parameters<typeof store.createAgent>[0] & { kit: Kit }).id }; } catch (e) { return { ok: false, error: (e as Error).message }; }
};
const results = inputs.map((i) => ({ input: i, ...outcome(i) }));
store.close();
for (const ext of ["-wal", "-shm"]) rmSync(join(dir, `helpers.db${ext}`), { force: true });
const db = new DatabaseSync(join(dir, "helpers.db"));
const all = (sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));
const agents = Object.fromEntries(readdirSync(join(dir, "agents")).sort().map((id) => [id, readFileSync(join(dir, "agents", id, "soul.md"), "utf8")]));
const state = {
  agents,
  souls: all("SELECT helper, version, name, personality, how_it_works, rules, lessons FROM souls ORDER BY helper, version"),
  audit: all("SELECT action, detail FROM audit_log WHERE action = 'agent' ORDER BY id").map((r: { action: string; detail: string }) => ({ action: r.action, detail: JSON.parse(r.detail) })),
};
db.close();
rmSync(dir, { recursive: true });
mkdirSync(fixtures, { recursive: true });
writeFileSync(join(fixtures, "agent-create.json"), `${JSON.stringify({ source: "services/helpers/src/store.ts", results, state }, null, 1)}\n`);
console.log(results.map((r) => ("ok" in r && r.ok ? `ok:${(r as { id: string }).id}` : "refused")).join(" "));
