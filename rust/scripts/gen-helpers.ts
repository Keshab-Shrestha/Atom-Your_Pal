// ADR-278 Phase 4: the fixture of the native `helpers` event (rust/crates/ark-runtime/src/helpers.rs). Runs the TypeScript helper store on fixed
// inputs and writes `tests/fixtures/helpers/` : `helpers.db`, `agents/<id>/soul.md` and `expected.json` (what the store gives, as JSON).
// Run from the repository root: node rust/scripts/gen-helpers.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openHelperStore } from "../../services/helpers/src/store.ts";
import { writeAgent } from "../../services/helpers/src/agents.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "crates", "ark-runtime", "tests", "fixtures", "helpers");
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "agents"), { recursive: true });
const home = "/private/tmp/ark-helpers-fixture-home";
mkdirSync(join(home, "proj"), { recursive: true });
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 1, 9, 0, tick++));
const soul = (name: string, personality: string, rest: Partial<Record<"howItWorks" | "rules" | "lessons", string>> = {}) => ({ name, personality, howItWorks: "", rules: "", lessons: "", ...rest });

// Agent folders: two good ones (one with a body line that starts with "## "), an unknown kit, a Manager file (not read), a bad name, a taken name.
const agentsDir = join(dir, "agents");
writeAgent(agentsDir, { id: "mochi", role: "cat keeper", kit: "folders", soul: soul("Mochi", "Sleepy and kind.", { howItWorks: "Line one.\n## not a heading\n\\## kept", rules: "Be soft." }) });
writeAgent(agentsDir, { id: "scout", role: "researcher", kit: "research", soul: soul("Scout", "Quick.") });
mkdirSync(join(agentsDir, "odd"));
writeFileSync(join(agentsDir, "odd", "soul.md"), "---\nname: Odd\nrole: tester\nkit: wizard\n---\n\n## Personality\nStrange.\n");
mkdirSync(join(agentsDir, "boss"));
writeFileSync(join(agentsDir, "boss", "soul.md"), "---\nname: Boss\nkind: manager\nmode: plan\n---\n\n## Personality\nPlans.\n");
mkdirSync(join(agentsDir, "bad"));
writeFileSync(join(agentsDir, "bad", "soul.md"), "---\nname: B4d!\nrole: tester\nkit: think\n---\n\n## Personality\nx\n");
mkdirSync(join(agentsDir, "twin"));
writeFileSync(join(agentsDir, "twin", "soul.md"), "---\nname: sid\nrole: tester\nkit: think\n---\n\n## Personality\nx\n");

const store = openHelperStore({ path: join(dir, "helpers.db"), now, home, agentsDir, skillsDir: join(dir, "skills"), checkpointsDir: join(dir, "checkpoints") });
store.list(); // keeps version 1 of each agent's soul
store.saveSoul("sid", soul("Sid", "Curious.", { lessons: "Cite twice." }));
store.saveSoul("sid", soul("Sid", "Curious and thorough.", { lessons: "Cite twice.", rules: "Say plainly." }));
store.restoreSoul("sid", 1);
store.saveSoul("mochi", soul("Mochi", "Sleepy.", { howItWorks: "Line one.\n## not a heading\n\\## kept", rules: "Be soft." }));
store.setApp("kame", "Xcode");
store.pin("sid", "claude-sonnet-5-5");
store.pinCodex("kame", "gpt-5-codex");
store.addGrant("kame", join(home, "proj"));
store.setSkills("sid", ["web-search", "pdf", "web-search"]);
store.setPlanFirst("kame", true);
store.setBrowser("sid", true);
store.setPaused("puff", true);

const problems = store.agentProblems();
const view = JSON.parse(JSON.stringify(store.list()));
writeFileSync(join(dir, "expected.json"), `${JSON.stringify({ source: "services/helpers/src/store.ts list()", helpers: view, problems }, null, 1)}\n`);
store.close?.();
for (const ext of ["-wal", "-shm"]) rmSync(join(dir, `helpers.db${ext}`), { force: true });
console.log(`helpers: ${view.length} members, ${problems.length} problems`);
