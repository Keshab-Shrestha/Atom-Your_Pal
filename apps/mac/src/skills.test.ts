import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLink, listSkills, prepareSkills } from "./skills.ts";

// Task 3.12: only the skills chosen for a worker are linked into its plugin.

function skillsDir() {
  const dir = mkdtempSync(join(tmpdir(), "zeno-skills-"));
  for (const [name, desc] of [["pdf", "Read and write PDFs."], ["council", '"Four voices."'], ["no-skill-md", ""]] as const) {
    mkdirSync(join(dir, name));
    if (desc) writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n`);
  }
  return dir;
}

test("Keshab's skills are the folders with a SKILL.md, with their descriptions", () => {
  const dir = skillsDir();
  try {
    assert.deepEqual(listSkills(dir), [{ name: "council", description: "Four voices." }, { name: "pdf", description: "Read and write PDFs." }]);
    assert.deepEqual(listSkills(join(dir, "nope")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a worker's plugin links exactly the chosen skills, and rebuilding drops the others without touching the skills", () => {
  const dir = skillsDir();
  const plugin = mkdtempSync(join(tmpdir(), "zeno-plugin-"));
  try {
    assert.deepEqual(prepareSkills(plugin, ["pdf", "council", "missing", "../etc"], dir).names, ["pdf", "council"]);
    assert.deepEqual(readdirSync(join(plugin, "skills")).sort(), ["council", "pdf"]);
    assert.ok(isLink(join(plugin, "skills", "pdf")));
    assert.equal(JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8")).name, "zeno-skills");
    prepareSkills(plugin, ["pdf"], dir);
    assert.deepEqual(readdirSync(join(plugin, "skills")), ["pdf"]);
    assert.ok(existsSync(join(dir, "council", "SKILL.md")), "the skill itself is untouched");
    assert.equal(realpathSync(join(plugin, "skills", "pdf")), realpathSync(join(dir, "pdf")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(plugin, { recursive: true, force: true });
  }
});
