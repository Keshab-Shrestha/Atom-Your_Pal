// ADR-082, Task 3.12: skills from ~/.claude/skills for a worker. Only the ones Keshab chose for it are loaded: ZENO
// builds a small local plugin per worker linking just those, and the run loads that plugin and nothing else (no user
// settings). Skill content is data for the task; it can never widen a worker's tools.

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SKILLS_PLUGIN = "zeno-skills";
export const SKILL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface SkillInfo {
  name: string;
  description: string;
}

export const userSkillsDir = () => join(homedir(), ".claude", "skills");

/** A SKILL.md's `description` from its front matter, cut to one line. */
function describe(file: string): string {
  try {
    const head = readFileSync(file, "utf8").slice(0, 4000);
    const m = /^---\s*\n([\s\S]*?)\n---/.exec(head);
    const line = m?.[1]?.split("\n").find((l) => /^description\s*:/.test(l));
    return (line?.replace(/^description\s*:\s*/, "").replace(/^["']|["']$/g, "") ?? "").slice(0, 200);
  } catch {
    return "";
  }
}

/** The skills Keshab has: folders with a SKILL.md and a plain name, sorted. Unreadable entries are left out. */
export function listSkills(dir = userSkillsDir()): SkillInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => SKILL_NAME.test(name) && existsSync(join(dir, name, "SKILL.md")))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, description: describe(join(dir, name, "SKILL.md")) }));
}

/**
 * The worker's plugin folder, rebuilt with links to exactly `names` (each must be one of Keshab's skills). Returns
 * the folder and the names actually linked.
 */
export function prepareSkills(pluginDir: string, names: readonly string[], dir = userSkillsDir()): { pluginDir: string; names: string[] } {
  const skills = join(pluginDir, "skills");
  rmSync(skills, { recursive: true, force: true }); // only links live here: nothing of the skills themselves is removed
  mkdirSync(skills, { recursive: true });
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: SKILLS_PLUGIN, version: "1.0.0", description: "The skills Keshab chose for this ZENO worker." }, null, 2),
  );
  const linked: string[] = [];
  for (const name of names) {
    const source = join(dir, name);
    if (!SKILL_NAME.test(name) || !existsSync(join(source, "SKILL.md"))) continue;
    symlinkSync(realpathSync(source), join(skills, name));
    linked.push(name);
  }
  return { pluginDir, names: linked };
}
