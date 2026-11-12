// ADR-278 Phase 4: the fixture of the native skill decisions (rust/crates/ark-runtime/src/helpers_skills.rs). Runs each command with the
// TypeScript store on a copy of a small base and records drafts, edits, audit rows and the skill files after it.
// From the repository root: node rust/scripts/gen-skills.ts
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openHelperStore } from "../../services/helpers/src/store.ts";
import { createHubCommands } from "../../apps/mac/src/hub-commands.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures", "skills");
rmSync(out, { recursive: true, force: true });
const base = join(out, "base");
mkdirSync(base, { recursive: true });
const open = (dir: string) => openHelperStore({ path: join(dir, "helpers.db"), skillsDir: join(dir, "skills"), home: join(dir, "home") });

const skill = (root: string, name: string, text: string) => { mkdirSync(join(root, name), { recursive: true }); writeFileSync(join(root, name, "SKILL.md"), text); };
const file = (description: string, body: string) => `---\nname: x\ndescription: ${description}\n---\n\n${body}\n`;
open(base).close();
skill(join(base, "skills"), "ark-has", file('"Has it"', "Old steps."));
skill(join(base, "skills"), "ark-one", file('"Does the thing"', "step a\nstep b"));
skill(join(base, "skills"), "ark-two", file("'Quoted'", "after the edit"));
skill(join(base, "skills"), "ark-three", file('"Three"', "someone changed me"));
skill(join(base, "skills"), "hubbed", file('"From the hub"', "hub steps"));
skill(join(base, "skills"), "shadowed", file('"Shadowed"', "ark steps"));
skill(join(base, "home", ".claude", "skills"), "user-has", file('"Yours"', "your steps"));
skill(join(base, "home", ".claude", "skills"), "shadowed", file('"Yours"', "your steps"));
const db = new DatabaseSync(join(base, "helpers.db"));
const draft = db.prepare("INSERT INTO skill_drafts (job_id, helper, name, description, body, state, created_at, decided_at) VALUES (?, 'sid', ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', ?)");
draft.run(1, "fresh-skill", 'Say "hi"\n  twice\tplease', "  Step one.\nStep two.\n\n", "pending", null);
draft.run(2, "ark-has", "Dup", "x", "pending", null);
draft.run(3, "user-has", "Dup", "x", "pending", null);
draft.run(4, "old-skill", "Old", "x", "approved", "2026-01-01T00:00:00.000Z");
draft.run(5, "plain-skill", "Ünïcode — dash", "Body", "pending", null);
const edit = db.prepare("INSERT INTO skill_edits (skill, job_id, old_body, new_body, reason, state, created_at) VALUES (?, ?, ?, ?, 'because', ?, '2026-01-01T00:00:00.000Z')");
edit.run("ark-one", 5, "step a\nstep b", "step a\n  step c  ", "pending");
edit.run("user-has", 5, "your steps", "mine", "pending");
edit.run("ark-two", 6, "before", "after the edit", "accepted");
edit.run("ark-three", 6, "before", "what I wrote", "accepted");
edit.run("hubbed", 7, "hub steps", "mine", "pending");
edit.run("gone", 7, "x", "y", "pending");
edit.run("ark-one", 8, "x", "y", "rejected");
edit.run("shadowed", 9, "ark steps", "mine", "pending");
edit.run("../evil", 9, "x", "y", "pending");
db.prepare("INSERT INTO skill_hub (name, repo, path, sha, origin_url, sha256, installed_at) VALUES ('hubbed', 'a/b', 'skills/hubbed/SKILL.md', ?, 'u', 'h', '2026-01-01T00:00:00.000Z')").run("a".repeat(40));
const pend = db.prepare("INSERT INTO skill_hub_installs (kind, name, description, repo, path, sha, text, flags, created_at) VALUES (?, ?, ?, 'a/b', ?, ?, ?, ?, '2026-01-01T00:00:00.000Z')");
pend.run("new", "cool", "Cool skill", "skills/cool/SKILL.md", "b".repeat(40), "---\nname: cool\n---\nRun curl http://x", JSON.stringify([{ kind: "shell-command", severity: "warn", excerpt: "Run curl http://x" }]));
pend.run("update", "hubbed", "Hub again", "skills/hubbed/SKILL.md", "c".repeat(40), "text", "[]");
db.close();
for (const ext of ["-wal", "-shm"]) rmSync(join(base, `helpers.db${ext}`), { force: true });
const hubStore = open(base);
const hubPayload = JSON.parse(JSON.stringify(createHubCommands({ store: hubStore, log: { info() {} } }).payload()));
hubStore.close();
for (const ext of ["-wal", "-shm"]) rmSync(join(base, `helpers.db${ext}`), { force: true });

const walk = (root: string, rel = ""): Record<string, string> => Object.assign({}, ...readdirSync(join(root, rel)).map((n) => {
  const p = join(rel, n);
  return statSync(join(root, p)).isDirectory() ? walk(root, p) : { [p]: readFileSync(join(root, p), "utf8") };
}));
const dump = (dir: string) => {
  const d = new DatabaseSync(join(dir, "helpers.db"));
  const all = (sql: string) => JSON.parse(JSON.stringify(d.prepare(sql).all()));
  const keep = (r: { decided_at?: string | null }) => (r.decided_at && r.decided_at !== "2026-01-01T00:00:00.000Z" ? { ...r, decided_at: "<now>" } : r);
  const result = {
    drafts: all("SELECT * FROM skill_drafts ORDER BY id").map(keep),
    edits: all("SELECT * FROM skill_edits ORDER BY id"),
    audit: all("SELECT action, detail FROM audit_log ORDER BY id").map((r: { action: string; detail: string }) => ({ action: r.action, detail: JSON.parse(r.detail) })),
    files: walk(join(dir, "skills")),
  };
  d.close();
  return result;
};
type Store = ReturnType<typeof open>;
const cmd = (type: string, id: number, run: (s: Store) => unknown) => ({ cmd: { type, id }, run });
const approve = (id: number) => cmd("skill.approve", id, (s) => s.approveSkillDraft(id));
const accept = (id: number) => cmd("skill.edit.accept", id, (s) => s.acceptSkillEdit(id));
const undo = (id: number) => cmd("skill.edit.undo", id, (s) => s.undoSkillEdit(id));
const ops = [
  { name: "approve", steps: [approve(1)] },
  { name: "approve twice", steps: [approve(1), approve(1)] },
  { name: "approve over an ARK skill", steps: [approve(2)] },
  { name: "approve over one of yours", steps: [approve(3)] },
  { name: "approve a decided draft", steps: [approve(4)] },
  { name: "approve unicode", steps: [approve(5)] },
  { name: "approve unknown", steps: [approve(99)] },
  { name: "accept", steps: [accept(1)] },
  { name: "accept then undo", steps: [accept(1), undo(1)] },
  { name: "accept twice", steps: [accept(1), accept(1)] },
  { name: "accept a skill of yours", steps: [accept(2)] },
  { name: "accept a hub skill", steps: [accept(5)] },
  { name: "accept a gone skill", steps: [accept(6)] },
  { name: "accept a rejected edit", steps: [accept(7)] },
  { name: "accept a shadowed skill", steps: [accept(8)] },
  { name: "accept a path name", steps: [accept(9)] },
  { name: "undo", steps: [undo(3)] },
  { name: "undo a changed skill", steps: [undo(4)] },
  { name: "undo a pending edit", steps: [undo(1)] },
  { name: "undo unknown", steps: [undo(99)] },
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
  const after = dump(dir);
  rmSync(dir, { recursive: true });
  return { name: op.name, cmds: op.steps.map((s) => s.cmd), outcomes, after };
});
writeFileSync(join(out, "expected.json"), `${JSON.stringify({ source: "services/helpers/src/skill-drafts.ts", before: dump(base), hubPayload, cases }, null, 1)}\n`);
console.log(cases.map((c) => `${c.name}=${c.outcomes.at(-1)}`).join("\n"));
