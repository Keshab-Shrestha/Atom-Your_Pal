import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentId, formatSoulMd, openHelperStore, parseSoulMd } from "./index.ts";

// ADR-088: agents Keshab adds, each a folder with its own role, kit and soul.md.

function setup() {
  const root = mkdtempSync(join(tmpdir(), "atom-agents-"));
  const agentsDir = join(root, "agents");
  return { root, agentsDir, store: openHelperStore({ path: ":memory:", agentsDir }), done: () => rmSync(root, { recursive: true, force: true }) };
}

const rumi = { name: "Rumi", role: "Travel Planner", kit: "research" as const, personality: "Calm and organised.", howItWorks: "Compares three options.", rules: "Prices with dates." };

test("a new agent becomes a folder with soul.md, joins the team, and works like the others", () => {
  const { agentsDir, store, done } = setup();
  try {
    const view = store.createAgent(rumi);
    assert.deepEqual([view.id, view.name, view.role, view.kit, view.custom, view.available, view.soulVersion], ["rumi", "Rumi", "travel planner", "research", true, true, 1]);
    const text = readFileSync(join(agentsDir, "rumi", "soul.md"), "utf8");
    assert.match(text, /^---\nname: Rumi\nrole: travel planner\nkit: research\n---\n\n## Personality\nCalm and organised\.\n/);
  } finally {
    done();
  }
});

test("editing soul.md in an editor becomes a new version; a save in the window writes the file back", () => {
  const { agentsDir, store, done } = setup();
  try {
    store.createAgent(rumi);
    const file = join(agentsDir, "rumi", "soul.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("Prices with dates.", "Prices with dates and links."));
    const after = store.list().find((h) => h.id === "rumi")!;
    assert.deepEqual([after.soul.rules, after.soulVersion], ["Prices with dates and links.", 2]);
    store.saveSoul("rumi", { ...after.soul, lessons: "Check visa rules." });
    assert.match(readFileSync(file, "utf8"), /## Lessons\nCheck visa rules\./);
    store.restoreSoul("rumi", 1);
    assert.match(readFileSync(file, "utf8"), /## Rules\nPrices with dates\.\n/);
    assert.equal(store.list().find((h) => h.id === "rumi")!.soulVersion, 4, "every version kept");
  } finally {
    done();
  }
});

test("a folder dropped in by hand is an agent; a broken one is named, not loaded", () => {
  const { agentsDir, store, done } = setup();
  try {
    mkdirSync(join(agentsDir, "mika"), { recursive: true });
    writeFileSync(join(agentsDir, "mika", "soul.md"), "---\nname: Mika\nrole: writer\nkit: think\n---\n## Personality\nWarm.\n");
    mkdirSync(join(agentsDir, "bad"), { recursive: true });
    writeFileSync(join(agentsDir, "bad", "soul.md"), "no front matter");
    mkdirSync(join(agentsDir, "clash"), { recursive: true });
    writeFileSync(join(agentsDir, "clash", "soul.md"), "---\nname: Sid\nrole: x\nkit: research\n---\n## Personality\nP.\n");
    const ids = store.list().map((h) => h.id);
    assert.ok(ids.includes("mika") && !ids.includes("bad") && !ids.includes("clash"));
    assert.equal(store.list().find((h) => h.id === "mika")!.kit, "think");
    const problems = store.agentProblems();
    assert.deepEqual(problems.map((p) => p.id), ["bad", "clash"]);
    assert.match(problems.find((p) => p.id === "bad")!.problem, /front matter/);
    assert.match(problems.find((p) => p.id === "clash")!.problem, /already called Sid/);
  } finally {
    done();
  }
});

test("kits and roles are checked; folders only for the folders kit; Tinker's role is taken", () => {
  const { store, done } = setup();
  try {
    assert.throws(() => store.createAgent({ ...rumi, kit: "admin" as never }), /research, folders or think/);
    assert.throws(() => store.createAgent({ ...rumi, role: "improver" }), /Tinker's/);
    assert.throws(() => store.createAgent({ ...rumi, role: "x".repeat(41) }), /too long/);
    assert.throws(() => store.createAgent({ ...rumi, name: "Sid" }), /already called Sid/);
    assert.throws(() => store.createAgent({ ...rumi, personality: " " }), /personality is empty/);
    store.createAgent(rumi);
    assert.throws(() => store.addGrant("rumi", "/tmp"), /does not work in folders/);
  } finally {
    done();
  }
});

test("removing an agent moves its folder aside, never deletes it; built-in workers cannot be removed", () => {
  const { root, agentsDir, store, done } = setup();
  try {
    store.createAgent(rumi);
    store.addJob("rumi", "Plan");
    store.removeAgent("rumi");
    assert.ok(!existsSync(join(agentsDir, "rumi")));
    assert.match(readdirSync(join(root, "agents-removed"))[0]!, /^rumi-/);
    assert.ok(!store.list().some((h) => h.id === "rumi"));
    assert.throws(() => store.removeAgent("sid"), /Only an agent you added/);
  } finally {
    done();
  }
});

test("soul.md round trip and folder names", () => {
  const soul = { name: "Ana", personality: "P", howItWorks: "H", rules: "R", lessons: "" };
  assert.deepEqual(parseSoulMd("ana", formatSoulMd({ role: "coach", kit: "folders", soul })), { id: "ana", role: "coach", kit: "folders", soul });
  assert.equal(parseSoulMd("x", "---\nname: X\nkit: root\n---\n").kit, "think", "an unknown kit means no tools");
  assert.equal(agentId("Ana Lí", ["ana-li"]), "ana-li-2");
  assert.equal(agentId("42", []), "a-42");
});

// 2026-10-16 (code review): a lesson with a "## " line was cut at that line the next time soul.md was read, and a bogus new soul version
// was saved. A line of soul text that starts with "## " is written with a backslash and read back without it.
test("soul text with lines that start with ## survives a write and a read unchanged", () => {
  const soul = {
    name: "Ana",
    personality: "Warm.\n## Not a section\nStill the personality.",
    howItWorks: "Steps:\n\\## already has a backslash\n\\\\## two backslashes\n### three hashes stay as they are\n# one hash too",
    rules: "## Rule heading\n## Another",
    lessons: "- First\n## Lesson 1\nDetail under it",
  };
  const text = formatSoulMd({ role: "coach", kit: "think", soul });
  assert.equal((text.match(/^## /gm) ?? []).length, 4, "only the four real section headings start with ##");
  const back = parseSoulMd("ana", text);
  assert.deepEqual(back.soul, soul);
  assert.equal(formatSoulMd({ role: back.role, kit: back.kit, soul: back.soul }), text, "writing it again changes nothing, so no bogus version");
});

// 2026-10-16 (review): the parser's heading is "##" plus any whitespace; only "## " (one space) was escaped, so "##<tab>Rules" cut the soul.
test("a soul line that starts with ## and a tab or other whitespace also survives a write and a read", () => {
  const soul = { name: "Ana", personality: "A\n##\tRules\nB\n##\u00a0not a section", howItWorks: "x", rules: "##  two spaces", lessons: "" };
  const text = formatSoulMd({ role: "coach", kit: "think", soul });
  const back = parseSoulMd("ana", text);
  assert.deepEqual(back.soul, soul);
  assert.equal(formatSoulMd({ role: back.role, kit: back.kit, soul: back.soul }), text);
});
