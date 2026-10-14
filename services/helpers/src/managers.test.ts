import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDelegateTool,
  formatSoulMd,
  handOffTool,
  managerNameFor,
  openHelperStore,
  parseSoulFile,
  readParts,
  teamContext,
  type HelperStore,
} from "./index.ts";

// ADR-095: Managers: soul files, the first-start migration, Keshab's commands and ATOM's hand-over.

function setup(seed?: (agentsDir: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "atom-managers-"));
  const agentsDir = join(root, "agents");
  seed?.(agentsDir);
  const path = join(root, "helpers.db");
  const open = () => openHelperStore({ path, agentsDir });
  return { root, agentsDir, path, open, done: () => rmSync(root, { recursive: true, force: true }) };
}

const agentFile = (dir: string, id: string, text: string) => {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "soul.md"), text);
};
const rumi = "---\nname: Rumi\nrole: travel planner\nkit: research\n---\n## Personality\nCalm.\n";
const managerOfView = (store: HelperStore, helper: string) => store.list().find((h) => h.id === helper)?.manager;

test("a Manager's soul.md has kind and mode; a kit or a manager of its own is refused; an Agent names its manager", () => {
  const soul = { name: "Research", personality: "Calm.", howItWorks: "", rules: "", lessons: "" };
  const text = formatSoulMd({ mode: "plan", soul });
  assert.match(text, /^---\nname: Research\nkind: manager\nmode: plan\n---\n/);
  assert.deepEqual(parseSoulFile("research", text), { id: "research", mode: "plan", soul });
  assert.equal((parseSoulFile("r", "---\nname: R\nkind: manager\n---\n") as { mode: string }).mode, "group", "group by default");
  assert.equal((parseSoulFile("r", "---\nname: R\nkind: manager\nmode: boss\n---\n") as { mode: string }).mode, "group");
  assert.throws(() => parseSoulFile("r", "---\nname: R\nkind: manager\nkit: research\n---\n"), /A Manager has no kit/);
  assert.throws(() => parseSoulFile("r", "---\nname: R\nkind: manager\nmanager: x\n---\n"), /cannot be under another Manager/);
  assert.throws(() => parseSoulFile("r", "---\nname: R\nkind: boss\n---\n"), /"kind" is agent or manager/);
  const agent = formatSoulMd({ role: "coach", kit: "think", soul, manager: "research" });
  assert.match(agent, /\nkit: think\nmanager: research\n---\n/);
  assert.equal((parseSoulFile("ana", agent) as { manager?: string }).manager, "research");
});

test("names for the first Managers come from the roles; a taken one gets Team", () => {
  assert.equal(managerNameFor("researcher", []), "Research");
  assert.equal(managerNameFor("financial adviser", []), "Finance");
  assert.equal(managerNameFor("travel planner", []), "Travel planner");
  assert.equal(managerNameFor("researcher", ["research"]), "Research Team");
  assert.equal(managerNameFor("researcher", ["Research", "Research Team"]), undefined);
});

test("the first start makes one Manager per role in use and puts every Agent under it, once", () => {
  const s = setup((dir) => agentFile(dir, "rumi", rumi));
  try {
    const store = s.open();
    const managers = store.managers();
    assert.deepEqual(
      managers.map((m) => [m.id, m.name, m.mode, m.soulVersion]),
      [["coding", "Coding", "group", 1], ["design", "Design", "group", 1], ["finance", "Finance", "group", 1], ["people", "People", "group", 1], ["research", "Research", "group", 1], ["travel-planner", "Travel planner", "group", 1], ["writing", "Writing", "group", 1]],
    );
    assert.deepEqual(managers.find((m) => m.id === "research")!.agents, ["sid"]);
    assert.equal(managerOfView(store, "kame"), "coding", "a built-in worker: a setting");
    assert.equal(managerOfView(store, "tinker"), undefined, "Tinker reviews; it works under no manager");
    // An agent Keshab added: manager in its soul.md, and the move recorded as a soul version.
    assert.match(readFileSync(join(s.agentsDir, "rumi", "soul.md"), "utf8"), /\nmanager: travel-planner\n---\n/);
    assert.equal(store.list().find((h) => h.id === "rumi")!.soulVersion, 2);
    assert.match(readFileSync(join(s.agentsDir, "research", "soul.md"), "utf8"), /^---\nname: Research\nkind: manager\nmode: group\n---\n/);
    store.close();
    // Idempotent: a second start changes nothing.
    const again = s.open();
    assert.equal(again.managers().length, 7);
    assert.equal(again.list().find((h) => h.id === "rumi")!.soulVersion, 2);
    assert.deepEqual(again.managers().map((m) => m.soulVersion), [1, 1, 1, 1, 1, 1, 1]);
    // Once done it stays done: Managers Keshab removes are not made again.
    again.setManager("rumi", "research");
    again.removeManager("travel-planner");
    again.close();
    const third = s.open();
    assert.equal(third.managers().some((m) => m.id === "travel-planner"), false);
    third.close();
  } finally {
    s.done();
  }
});

test("a start that stopped before the migration's setting places the rest on the next start, without duplicates", () => {
  const s = setup((dir) => agentFile(dir, "rumi", rumi));
  try {
    s.open().close();
    // As if the first start stopped after writing the Managers: Rumi unplaced and the setting not written.
    const file = join(s.agentsDir, "rumi", "soul.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("manager: travel-planner\n", ""));
    const db = new DatabaseSync(s.path);
    db.prepare("DELETE FROM helper_settings WHERE key = 'managers:migrated'").run();
    db.close();
    const store = s.open();
    assert.equal(managerOfView(store, "rumi"), "travel-planner", "placed again");
    assert.equal(store.managers().length, 7, "no duplicate Managers");
    assert.equal(store.managers().some((m) => m.name.endsWith(" Team")), false);
    store.close();
  } finally {
    s.done();
  }
});

test("an unknown manager is a problem the Agent works through; a Manager with a kit is not loaded", () => {
  const s = setup();
  try {
    s.open().close(); // the first-start migration ran
    agentFile(s.agentsDir, "boss", "---\nname: Boss\nkind: manager\nmode: plan\n---\n## Personality\nP.\n");
    agentFile(s.agentsDir, "badboss", "---\nname: Badboss\nkind: manager\nkit: research\n---\n## Personality\nP.\n");
    agentFile(s.agentsDir, "mika", "---\nname: Mika\nrole: writer\nkit: think\nmanager: nobody\n---\n## Personality\nWarm.\n");
    const store = s.open();
    assert.ok(store.managers().some((m) => m.id === "boss"));
    assert.equal(store.managers().some((m) => m.id === "badboss"), false);
    assert.equal(managerOfView(store, "mika"), undefined);
    assert.ok(store.list().some((h) => h.id === "mika"), "it still works");
    const problems = Object.fromEntries(store.agentProblems().map((p) => [p.id, p.problem]));
    assert.match(problems.mika!, /Its manager "nobody" does not exist/);
    assert.match(problems.badboss!, /A Manager has no kit/);
    assert.throws(() => store.addJob("boss", "Do it"), /There is no helper/, "a Manager takes no tasks of its own");
  } finally {
    s.done();
  }
});

test("Keshab creates, renames, switches and removes Managers, and moves Agents between them", () => {
  const s = setup((dir) => agentFile(dir, "rumi", rumi));
  try {
    const store = s.open();
    const made = store.createManager({ name: "Travel" });
    assert.deepEqual([made.id, made.mode, made.agents], ["travel", "group", []]);
    assert.throws(() => store.createManager({ name: "Sid" }), /Another worker is already called Sid/);
    assert.throws(() => store.createManager({ name: "Coding" }), /already called Coding/);
    assert.throws(() => store.createManager({ name: "X", mode: "boss" as "plan" }), /plans and reviews/);
    store.setManager("rumi", "travel");
    assert.match(readFileSync(join(s.agentsDir, "rumi", "soul.md"), "utf8"), /\nmanager: travel\n/);
    assert.equal(store.list().find((h) => h.id === "rumi")!.soulVersion, 3, "every move is a version");
    store.setManager("sid", "travel");
    assert.deepEqual(store.managers().find((m) => m.id === "travel")!.agents, ["sid", "rumi"]);
    assert.throws(() => store.setManager("tinker", "travel"), /works under no manager/);
    assert.throws(() => store.setManager("sid", "nope"), /no such manager/);
    store.renameManager("travel", "Trips");
    const trips = store.managers().find((m) => m.id === "travel")!;
    assert.deepEqual([trips.name, trips.soulVersion], ["Trips", 2]);
    assert.match(readFileSync(join(s.agentsDir, "travel", "soul.md"), "utf8"), /^---\nname: Trips\nkind: manager\nmode: group\n/);
    store.setManagerMode("travel", "plan");
    assert.equal(store.managers().find((m) => m.id === "travel")!.mode, "plan");
    assert.throws(() => store.removeManager("travel"), /Trips still has Agents/);
    store.setManager("sid", "research");
    store.setManager("rumi", "research");
    store.removeManager("travel");
    assert.equal(existsSync(join(s.agentsDir, "travel")), false);
    assert.ok(readdirSync(join(s.root, "agents-removed")).some((n) => n.startsWith("travel-")), "moved, never deleted");
    // A new agent goes under the Manager of an Agent with its role.
    store.createAgent({ name: "Ada", role: "researcher", kit: "research", personality: "Sharp." });
    assert.equal(managerOfView(store, "ada"), "research");
  } finally {
    s.done();
  }
});

test("ATOM hands work to Managers: a group's Agents directly, a plan Manager by its name", () => {
  const s = setup();
  try {
    const store = s.open();
    store.setManagerMode("coding", "plan");
    const workers = store.list();
    const managers = store.managers();
    assert.deepEqual(readParts([{ worker: "Sid", task: "Find" }], workers, managers), [{ helper: "sid", task: "Find" }], "group: its Agent");
    assert.throws(() => readParts([{ worker: "Research", task: "Find" }], workers, managers), /Research assigns directly: give task 1 to one of its agents \(Sid\)/);
    assert.deepEqual(readParts([{ worker: "coding", task: "Fix" }], workers, managers), [{ helper: "coding", task: "Fix" }], "plan: the Manager");
    assert.throws(() => readParts([{ worker: "Kame", task: "Fix" }], workers, managers), /Kame works under Coding, which plans its own work/);
    const context = teamContext(workers, managers);
    assert.match(context, /^Your team, by manager: Coding \(a manager that plans and reviews: give it its whole part by the name Coding; its agents: Kame \(coder\)\); /);
    assert.match(context, /Research \(give tasks to its agents directly: Sid \(researcher\)\)/);
    const said = createDelegateTool({ store }).run({ goal: "site", tasks: [{ worker: "Sid", task: "Research" }, { worker: "Coding", task: "Build it", after: [1] }] });
    assert.match(said, /Sid \(task 1\); Coding \(task 2, after Sid\)/);
    assert.throws(() => store.addGoal("x", [{ helper: "research", task: "y" }]), /assigns directly/, "the store checks again");
  } finally {
    s.done();
  }
});

test("a plan Manager splits its part across its Agents (at most six), waits for them, and asks for one revision at most", () => {
  const s = setup((dir) => agentFile(dir, "ada", "---\nname: Ada\nrole: coder\nkit: think\n---\n## Personality\nSharp.\n"));
  try {
    const store = s.open();
    store.setManagerMode("coding", "plan");
    const goal = store.addGoal("Site", [{ helper: "coding", task: "Build the site" }]);
    const boss = goal.tasks[0]!;
    assert.throws(() => store.managerSplit(boss.id, [{ helper: "kame", task: "x" }]), /Only a running task/);
    store.start(boss.id);
    assert.throws(() => store.managerSplit(boss.id, Array.from({ length: 7 }, () => ({ helper: "kame", task: "x" }))), /1 to 6 tasks/);
    assert.throws(() => store.managerSplit(boss.id, [{ helper: "sid", task: "x" }]), /Sid is not one of Coding's Agents/);
    assert.throws(() => store.managerSplit(boss.id, [{ helper: "kame", task: "x", after: [1] }]), /only wait for tasks before it/);
    const [a, b] = store.managerSplit(boss.id, [{ helper: "kame", task: "Pages" }, { helper: "ada", task: "Styles", after: [1] }]);
    assert.deepEqual([a!.parentId, a!.goal, b!.blockedBy], [boss.id, "Site", [a!.id]]);
    assert.throws(() => store.managerSplit(boss.id, [{ helper: "kame", task: "again" }]), /split already/);
    store.finish(boss.id, { title: "Split", summary: "Two tasks.", body: "1. Pages\n2. Styles", sources: [] });
    assert.equal(store.get(boss.id)!.state, "queued", "it runs again once its tasks end");
    assert.deepEqual(store.get(boss.id)!.waitingFor, [a!.id, b!.id]);
    assert.equal(store.goal(goal.id)!.endedAt, undefined);
    for (const t of [a!, b!]) {
      store.start(t.id);
      store.finish(t.id, { title: t.task, summary: "Done.", body: "Body.", sources: [{ title: "S", url: "https://example.com" }] });
    }
    assert.deepEqual(store.queued().map((j) => j.id), [boss.id]);
    store.start(boss.id);
    assert.deepEqual(store.managerWork(boss.id).tasks.map((t) => [t.id, t.state, t.worker]), [[a!.id, "done", "Kame"], [b!.id, "done", "Ada"]]);
    assert.throws(() => store.managerRevise(boss.id, 999, "x"), /not one of this manager's tasks/);
    store.managerRevise(boss.id, a!.id, "Add a contact page.");
    assert.equal(store.get(a!.id)!.state, "queued", "the note wakes the task");
    assert.deepEqual(store.thread(a!.id)!.comments.map((c) => c.text), ["Add a contact page."]);
    assert.throws(() => store.managerRevise(boss.id, b!.id, "More."), /one revision at most/);
    assert.equal(store.managerWork(boss.id).revised, true);
    store.finish(boss.id, { title: "Revising", summary: "Asked Kame.", body: "Asked Kame.", sources: [] });
    assert.deepEqual(store.get(boss.id)!.waitingFor, [a!.id], "waits for the revision");
    assert.ok(store.thread(boss.id)!.activity.some((e) => e.kind === "split") && store.thread(boss.id)!.activity.some((e) => e.kind === "revised"));
  } finally {
    s.done();
  }
});

test("a Manager's task is not rated or made a skill; an Agent task that ends unfinished does not fail the Manager", () => {
  const s = setup();
  try {
    const store = s.open();
    store.setManagerMode("research", "plan");
    const boss = store.addGoal("G", [{ helper: "research", task: "Find" }]).tasks[0]!;
    store.start(boss.id);
    const [a] = store.managerSplit(boss.id, [{ helper: "sid", task: "Find" }]);
    store.finish(boss.id, { title: "Split", summary: "One.", body: "One.", sources: [] });
    store.start(a!.id);
    // An Agent's task hands off as a top-level task does: a Manager's task is not a level.
    assert.notEqual(handOffTool(store, store.get(a!.id)!), undefined);
    const sub = store.handOff(a!.id, "penny", "Find the prices");
    assert.equal(handOffTool(store, store.get(sub.id)!), undefined, "a sub-task still cannot hand off again");
    store.remove(sub.id);
    store.stop(a!.id); // stopped (a failure would run again: it handed off)
    assert.equal(store.get(boss.id)!.state, "queued", "it reviews what it has");
    assert.deepEqual(store.get(boss.id)!.waitingFor, []);
    store.start(boss.id);
    store.finish(boss.id, { title: "Summary", summary: "Nothing found.", body: "Sid could not load the pages.", sources: [] });
    assert.throws(() => store.rate(boss.id, false), /rated through its Agents' tasks/);
    assert.throws(() => store.makeSkill(boss.id), /does not become a skill/);
    assert.equal(store.soul("research").name, "Research");
  } finally {
    s.done();
  }
});
