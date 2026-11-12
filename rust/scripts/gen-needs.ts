// ADR-278 Phase 4: the fixture of the Telegram Needs-you list in Rust (rust/crates/ark-runtime/src/helpers_team.rs). Runs `needsYou` of
// apps/mac/src/telegram-bot.ts on a copy of the helper fixture (plus two questions and a hub skill that waits) and records the items.
// Run `node rust/scripts/gen-helpers.ts` first, then from the repository root: node rust/scripts/gen-needs.ts
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openHelperStore } from "../../services/helpers/src/store.ts";
import { needsYou } from "../../apps/mac/src/telegram-bot.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures");
const out = join(fixtures, "needs");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const base = join(out, "base");
cpSync(join(fixtures, "helpers"), base, { recursive: true });
rmSync(join(base, "expected.json"));
const db = new DatabaseSync(join(base, "helpers.db"));
db.prepare("INSERT INTO skill_hub_installs (kind, name, description, repo, path, sha, text, flags, created_at) VALUES ('update', 'hubbed', 'D', 'a/b', 'skills/hubbed/SKILL.md', ?, 't', ?, '2026-01-01T00:00:00.000Z')").run("c".repeat(40), JSON.stringify([{ kind: "url", severity: "info", excerpt: "x" }, { kind: "url", severity: "info", excerpt: "y" }, { kind: "html-comment", severity: "warn", excerpt: "z" }]));
db.close();
for (const ext of ["-wal", "-shm"]) rmSync(join(base, `helpers.db${ext}`), { force: true });
const store = openHelperStore({ path: join(base, "helpers.db"), agentsDir: join(base, "agents"), home: "/private/tmp/ark-helpers-fixture-home" });
const asks = [{ id: "q1", summary: "Run a command", reason: "It lists files", fileReview: false }, { id: "q2", summary: "Edit a file", reason: "Review it", fileReview: true }];
const items = JSON.parse(JSON.stringify(needsYou(store, asks as never)));
const tasks = store.list().flatMap((h) => h.jobs.filter((j) => j.state === "running" || j.state === "queued").map((j) => ({ id: j.id, state: j.state })));
store.close();
for (const ext of ["-wal", "-shm"]) rmSync(join(base, `helpers.db${ext}`), { force: true });
writeFileSync(join(out, "expected.json"), `${JSON.stringify({ source: "apps/mac/src/telegram-bot.ts needsYou", asks, items, tasks }, null, 1)}\n`);
console.log(items.map((i: { key: string; push: boolean }) => `${i.key}${i.push ? "" : " (no push)"}`).join(", "));
