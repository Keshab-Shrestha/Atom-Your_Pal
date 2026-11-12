// ADR-278 Phase 4: the fixture of the native `helpers` event (rust/crates/ark-runtime/src/helpers.rs). Runs the TypeScript helper store on fixed
// inputs and writes `tests/fixtures/helpers/` : `helpers.db`, `agents/<id>/soul.md` and `expected.json` (what the store gives, as JSON).
// Run from the repository root: node rust/scripts/gen-helpers.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.env.TZ = "Asia/Tokyo"; // routines show their next time in local time; the Rust test uses the same zone
import { openHelperStore } from "../../services/helpers/src/store.ts";
import { islandHelpers } from "../../apps/mac/src/island-helpers.ts";
import { DatabaseSync } from "node:sqlite";
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

store.addRoutine("sid", "Summarise networking news", { kind: "daily", minute: 8 * 60 + 5 }, undefined, true, false);
const r2 = store.addRoutine("kame", "Weekly review", { kind: "weekly", weekday: 1, minute: 21 * 60 + 30 }, undefined, false, true);
store.addRoutine("sid", "Hourly check", { kind: "hours", every: 3 }, new Date(Date.UTC(2026, 10, 2, 0, 0, 0)));
store.addRoutine("mochi", "Every hour", { kind: "hours", every: 1 }, undefined);
store.addRoutine("quill", "Midnight", { kind: "daily", minute: 0 }, undefined);
const r6 = store.addRoutine("hana", "Sunday noon", { kind: "weekly", weekday: 0, minute: 12 * 60 }, undefined);
store.pauseRoutine(r6.id, true);
store.runRoutines(() => true); // marks the due ones (lastAt)
void r2;
// Tasks in every state, with blockers, notes, labels, a parent and a report.
const rep = (title: string) => ({ title, summary: `${title} summary.`, body: "Body.", sources: [] });
const j1 = store.addJob("sid", "Research networking basics", { goal: "Learn networking" }).id;
store.start(j1);
store.setModel(j1, "claude-sonnet-5-5", "cheap and enough");
store.finish(j1, rep("Networking"));
store.rate(j1, true, "Good");
store.addLabel(j1, "Research");
store.addLabel(j1, "alpha");
store.addComment(j1, "A note");
store.addComment(j1, "Another note");
const j2 = store.addJob("kame", "Fix the parser").id;
store.start(j2);
store.step(j2, "Reading code");
const j3 = store.addJob("sid", "Write the summary", { blockedBy: [j1, j2], planFirst: true }).id;
const j4 = store.addJob("sid", "Doomed task").id;
store.start(j4);
store.fail(j4, "It broke", true);
const j5 = store.addJob("sid", "Stopped task").id;
store.stop(j5);
const j6 = store.addJob("kame", "Child of the parser fix", { parentId: j2 }).id;
const j7 = store.addJob("quill", "Quiet task").id;
store.start(j7);
store.finish(j7, rep("Quiet"));
const j8 = store.addJob("mochi", "Retried task").id;
const raw = new DatabaseSync(join(dir, "helpers.db"));
raw.prepare("INSERT INTO goals (text, created_at, ended_at) VALUES ('Learn networking', '2026-11-01T09:00:00.000Z', '2026-11-02T09:00:00.000Z')").run();
raw.prepare("UPDATE jobs SET goal_id = 1 WHERE id = ?").run(j1);
raw.prepare("UPDATE jobs SET interrupted = 1, session_id = 's1', auto_retries = 2, chat_id = 'chat-9' WHERE id = ?").run(j3);
raw.prepare("UPDATE jobs SET recovery_needed = 1, step = 'Last step', native_scope = 'advisory' WHERE id = ?").run(j4);
raw.prepare("UPDATE jobs SET plan_status = 'awaiting', plan_summary = 'The plan.' WHERE id = ?").run(j6);
raw.prepare("UPDATE jobs SET retry_of = ?, retry_next = ? WHERE id = ?").run(j5, null, j8);
raw.prepare("UPDATE jobs SET reviews = ? WHERE id = ?").run(j1, j7);
raw.close();
// Proposals (pending, accepted, rejected) and test cases with a run.
store.rate(j4, false, "Not good");
const review = store.list().find((h) => h.id === "tinker")!.jobs.find((j) => j.task.startsWith("Review task"))!.id;
const p1 = store.addProposal(review, { field: "rules", text: "Be brief.", reason: "Too long." }).id;
const p2 = store.addProposal(review, { field: "lessons", text: "Check twice.", reason: "A miss." }).id;
const p3 = store.addProposal(review, { field: "personality", text: "Curious, calm.", reason: "Tone." }).id;
store.acceptProposal(p1);
store.rejectProposal(p2);
const j9 = store.addJob("sid", "A finished example").id;
store.start(j9);
store.finish(j9, rep("Example"));
const c1 = store.saveTestCase(j9, "soul", "sid");
store.saveTestCase(j7, "soul", "quill");
store.startTestRun("soul", p3, [c1]);
store.finishTestCase("soul", p3, c1, { state: "done", better: "new", reason: "Clearer.", oldAnswer: "Old " + "x".repeat(900), newAnswer: "New answer." });
const raw2 = new DatabaseSync(join(dir, "helpers.db"));
raw2.prepare("INSERT INTO test_results (kind, item_id, case_id, task, state, better, reason, old_answer, new_answer, at) VALUES ('soul', ?, 99, 'A skipped case', 'skipped', NULL, 'Too long', NULL, NULL, '2026-11-01T10:00:00.000Z')").run(p3);
raw2.prepare("INSERT INTO test_results (kind, item_id, case_id, task, state, better, reason, old_answer, new_answer, at) VALUES ('soul', ?, 100, 'Same case', 'done', 'same', NULL, 'a', 'b', '2026-11-01T10:00:00.000Z')").run(p3);
raw2.close();
const problems = store.agentProblems();
const NOW = new Date(Date.UTC(2026, 10, 12, 11, 30, 0)); // 2026-11-12 20:30 in Tokyo, a Thursday
const island = islandHelpers(store, async () => [], () => [], () => [], () => NOW);
const view = JSON.parse(JSON.stringify(island.list()));
const testCases = JSON.parse(JSON.stringify(island.testCases()));
writeFileSync(join(dir, "expected.json"), `${JSON.stringify({ source: "apps/mac/src/island-helpers.ts list()", now: NOW.toISOString(), testCases, helpers: view, problems }, null, 1)}\n`);
store.close?.();
for (const ext of ["-wal", "-shm"]) rmSync(join(dir, `helpers.db${ext}`), { force: true });
console.log(`helpers: ${view.length} members, ${problems.length} problems`);
