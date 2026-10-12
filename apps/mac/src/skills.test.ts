import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills, prepareSkills } from "./skills.ts";

// Task 3.12: only the skills chosen for a worker are linked into its plugin.

function skillsDir() {
  const dir = mkdtempSync(join(tmpdir(), "atom-skills-"));
  for (const [name, desc] of [["pdf", "Read and write PDFs."], ["council", '"Four voices."'], ["no-skill-md", ""]] as const) {
    mkdirSync(join(dir, name));
    if (desc) writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n`);
  }
  return dir;
}

test("Keshab's skills are the folders with a SKILL.md, with their descriptions", () => {
  const dir = skillsDir();
  try {
    assert.deepEqual(listSkills(dir), [{ name: "council", description: "Four voices.", source: "yours" }, { name: "pdf", description: "Read and write PDFs.", source: "yours" }]);
    assert.deepEqual(listSkills(join(dir, "nope")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a worker's plugin links exactly the chosen skills, and rebuilding drops the others without touching the skills", () => {
  const dir = skillsDir();
  const plugin = mkdtempSync(join(tmpdir(), "atom-plugin-"));
  try {
    assert.deepEqual(prepareSkills(plugin, ["pdf", "council", "missing", "../etc"], dir).names, ["pdf", "council"]);
    assert.deepEqual(readdirSync(join(plugin, "skills")).sort(), ["council", "pdf"]);
    assert.ok(lstatSync(join(plugin, "skills", "pdf")).isSymbolicLink());
    assert.equal(JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8")).name, "atom-skills");
    prepareSkills(plugin, ["pdf"], dir);
    assert.deepEqual(readdirSync(join(plugin, "skills")), ["pdf"]);
    assert.ok(existsSync(join(dir, "council", "SKILL.md")), "the skill itself is untouched");
    assert.equal(realpathSync(join(plugin, "skills", "pdf")), realpathSync(join(dir, "pdf")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(plugin, { recursive: true, force: true });
  }
});

test("ATOM's own skills are listed and linked too, unless Keshab has one of the same name (ADR-094)", () => {
  const dir = skillsDir();
  const zeno = mkdtempSync(join(tmpdir(), "atom-own-"));
  const plugin = mkdtempSync(join(tmpdir(), "atom-plugin-"));
  try {
    for (const name of ["compare-laptops", "pdf"]) {
      mkdirSync(join(zeno, name));
      writeFileSync(join(zeno, name, "SKILL.md"), `---\nname: ${name}\ndescription: "ATOM's ${name}."\n---\n\nSteps.\n`);
    }
    assert.deepEqual(
      listSkills(dir, zeno).map((s) => [s.name, s.source, s.description]),
      [["compare-laptops", "zeno", "ATOM's compare-laptops."], ["council", "yours", "Four voices."], ["pdf", "yours", "Read and write PDFs."]],
    );
    assert.deepEqual(prepareSkills(plugin, ["compare-laptops", "pdf"], dir, zeno).names, ["compare-laptops", "pdf"]);
    assert.equal(realpathSync(join(plugin, "skills", "compare-laptops")), realpathSync(join(zeno, "compare-laptops")));
    assert.equal(realpathSync(join(plugin, "skills", "pdf")), realpathSync(join(dir, "pdf")), "Keshab's wins a clash");
  } finally {
    for (const d of [dir, zeno, plugin]) rmSync(d, { recursive: true, force: true });
  }
});

test("a ATOM skill whose name is in the hub list has source \"hub\" (B3.5)", () => {
  const dir = skillsDir();
  const zeno = mkdtempSync(join(tmpdir(), "atom-own-"));
  try {
    for (const name of ["made-here", "from-hub"]) {
      mkdirSync(join(zeno, name));
      writeFileSync(join(zeno, name, "SKILL.md"), `---\nname: ${name}\ndescription: "D."\n---\n\nSteps.\n`);
    }
    const sources = (hub?: Set<string>) => listSkills(dir, zeno, hub).filter((s) => ["made-here", "from-hub"].includes(s.name)).map((s) => [s.name, s.source]);
    assert.deepEqual(sources(new Set(["from-hub"])), [["from-hub", "hub"], ["made-here", "zeno"]]);
    assert.deepEqual(sources(), [["from-hub", "zeno"], ["made-here", "zeno"]]);
    assert.deepEqual(listSkills(dir, zeno, new Set(["pdf"])).find((s) => s.name === "pdf")?.source, "yours", "Keshab's own skill is never relabelled");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(zeno, { recursive: true, force: true });
  }
});
