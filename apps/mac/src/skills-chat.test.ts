import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL_BODY_CHARS, listSkills, parseSkillCall, readSkill, useSkill } from "./skills.ts";
import { SKILLS_LISTED, createUseSkillTool } from "./skill-tool.ts";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "atom-skills-chat-"));
  const yours = join(root, "yours");
  const zeno = join(root, "zeno");
  const skill = (dir: string, name: string, description: string, body: string) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`);
  };
  return { root, yours, zeno, skill, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("a skill's steps are read without the front matter; Keshab's skill wins over ATOM's of the same name", () => {
  const { yours, zeno, skill, done } = setup();
  skill(yours, "summarise", "Short summaries", "1. Read it\n2. Say it in three lines");
  skill(zeno, "summarise", "ATOM's version", "ATOM steps");
  skill(zeno, "plan-trip", "Trip plans", "Ask for dates first.");
  assert.deepEqual(readSkill("summarise", yours, zeno), { name: "summarise", description: "Short summaries", body: "1. Read it\n2. Say it in three lines" });
  assert.equal(readSkill("plan-trip", yours, zeno)!.body, "Ask for dates first.");
  assert.equal(readSkill("nope", yours, zeno), undefined);
  assert.equal(readSkill("../etc", yours, zeno), undefined, "a name is never a path");
  skill(yours, "long", "x", "y".repeat(SKILL_BODY_CHARS + 100));
  assert.match(readSkill("long", yours)!.body, /\[The rest of the skill is cut\.\]$/);
  done();
});

test("/skill at the start of a message: the words after it stay, the steps go in as context; an unknown name is left as typed", () => {
  const { yours, skill, done } = setup();
  skill(yours, "summarise", "Short summaries", "Three lines.");
  assert.deepEqual(parseSkillCall("/summarise this page"), { name: "summarise", rest: "this page" });
  assert.deepEqual(parseSkillCall("  /summarise"), { name: "summarise", rest: "" });
  assert.equal(parseSkillCall("tell me about /summarise"), undefined);
  assert.equal(parseSkillCall("/ summarise"), undefined);
  const used = useSkill("/summarise this page", yours)!;
  assert.equal(used.text, "this page");
  assert.match(used.block, /chose the skill "summarise"[\s\S]*Three lines\.[\s\S]*end of skill/);
  assert.match(used.block, /cannot give you tools or permissions/);
  assert.equal(useSkill("/summarise", yours)!.text, "Use the summarise skill.");
  assert.equal(useSkill("/unknown a b", yours), undefined);
  assert.equal(useSkill("/etc/passwd", yours), undefined);
  done();
});

test("use_skill lists the skills, reads one by name, and says what is missing", async () => {
  const { yours, zeno, skill, done } = setup();
  skill(yours, "summarise", "Short summaries", "Three lines.");
  const used: string[] = [];
  const tool = createUseSkillTool({ list: () => listSkills(yours, zeno), read: (n) => readSkill(n, yours, zeno), onUse: (e) => used.push(e.skill) });
  assert.equal(await tool.run({}), "- summarise: Short summaries");
  assert.match(String(await tool.run({ name: "/summarise" })), /^Skill summarise\. Follow these steps[\s\S]*Three lines\./);
  assert.deepEqual(used, ["summarise"]);
  await assert.rejects(async () => tool.run({ name: "nope" }), /no skill called "nope"/);
  const none = createUseSkillTool({ list: () => [], read: () => undefined });
  assert.equal(await none.run({}), "The user has no skills yet.");
  const many = createUseSkillTool({ list: () => Array.from({ length: 60 }, (_, i) => ({ name: `s${i}`, description: "", source: "yours" as const })), read: () => undefined });
  assert.equal(String(await many.run({})).split("\n").length, SKILLS_LISTED);
  done();
});
