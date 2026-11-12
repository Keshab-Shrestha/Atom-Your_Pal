// ADR-278: the fixture of native `project.add` and `project.remove` (rust/crates/ark-runtime/src/projects_add.rs). Runs the TypeScript
// `createProjects` on the helpers-writes base and records each result and the final rows and files. Paths are `<root>/home/...`.
// From the repository root: node rust/scripts/gen-project-add.ts
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openHelperStore } from "../../services/helpers/src/store.ts";
import { openMemoryStore } from "../../services/memory/src/index.ts";
import { createProjects } from "../../apps/mac/src/projects-wiring.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures");
const root = realpathSync(mkdtempSync(join(tmpdir(), "ark-project-add-")));
const home = join(root, "home");
for (const d of ["Developer/haat", "Developer/other", "Developer/notes", "Library/Keys", ".ssh"]) mkdirSync(join(home, d), { recursive: true });
writeFileSync(join(home, "file.txt"), "x");
const hdir = join(root, "h");
cpSync(join(fixtures, "helpers-writes", "base"), hdir, { recursive: true });
const memory = openMemoryStore({ path: ":memory:" });
const helpers = openHelperStore({ path: join(hdir, "helpers.db"), agentsDir: join(hdir, "agents"), home });
const log = { info: () => {}, warn: () => {} };
const projects = createProjects({ memory, helpers, home, log, checkModel: () => ({ error: "no" }) });
const adds: [string, string][] = [
  ["Haat", "Developer/haat"], ["Haat Two", "Developer/haat"], ["haat", "Developer/other"], ["Other", "Developer/other"], ["Haat!", "Developer/notes"],
  ["Lib", "Library/Keys"], ["Ssh", ".ssh"], ["Home", ""], ["Rel", "REL"], ["Gone", "Developer/gone"], ["File", "file.txt"], ["  ", "Developer/notes"], ["a\nb", "Developer/notes"], ["Haat", "Developer/notes"],
];
const results: Record<string, unknown>[] = adds.map(([name, rel]) => {
  const path = rel === "REL" ? "Developer/haat" : rel === "" ? home : join(home, rel);
  const r = projects.island.add(name, path) as { ok?: true; error?: string };
  return { op: "add", name, path: path.replace(root, "<root>"), ...(r.ok ? { ok: true } : { ok: false, error: r.error }) };
});
const byName = (n: string) => memory.projects.list().find((p) => p.name === n)!;
const other = byName("Other");
const rm = projects.island.remove(other.id, false) as { ok?: true; error?: string };
results.push({ op: "remove", name: "Other", ok: Boolean(rm.ok) });
const rmNone = projects.island.remove("p-none", false) as { ok?: true; error?: string };
results.push({ op: "remove", name: "p-none", ok: Boolean(rmNone.ok), ...(rmNone.error ? { error: rmNone.error } : {}) });
const rows = memory.projects.list().map((p) => ({ name: p.name, folders: p.folders.map((f) => f.replace(root, "<root>")), helper: p.helper ?? null, kit: p.kit, web: p.web, archived: p.archived })).reverse();
const items = projects.island.list().map((i) => ({ name: i.name, folderLabel: i.folderLabel, missing: i.missing, archived: i.archived, chatCount: i.chatCount, web: i.web, agent: i.agent ?? null })).reverse();
helpers.close();
for (const ext of ["-wal", "-shm"]) rmSync(join(hdir, `helpers.db${ext}`), { force: true });
const db = new DatabaseSync(join(hdir, "helpers.db"));
const all = (sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));
const state = {
  agents: Object.fromEntries(readdirSync(join(hdir, "agents")).sort().map((id) => [id, readFileSync(join(hdir, "agents", id, "soul.md"), "utf8")])),
  souls: all("SELECT helper, version, name FROM souls ORDER BY helper, version"),
  grants: all("SELECT helper, path FROM grants ORDER BY helper, path").map((g: { helper: string; path: string }) => ({ ...g, path: g.path.replace(root, "<root>") })),
  audit: all("SELECT action, detail FROM audit_log WHERE action IN ('agent', 'grant') ORDER BY id").map((r: { action: string; detail: string }) => ({ action: r.action, detail: JSON.parse(r.detail) })),
};
db.close();
rmSync(root, { recursive: true });
writeFileSync(join(fixtures, "project-add.json"), `${JSON.stringify({ source: "apps/mac/src/projects-wiring.ts", results, rows, items, state }, null, 1)}\n`);
console.log(results.map((r) => `${r.op}:${r.ok ? "ok" : "refused"}`).join(" "));
