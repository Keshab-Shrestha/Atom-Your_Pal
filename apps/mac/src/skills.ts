// ADR-082, Task 3.12: skills from ~/.claude/skills for a worker. Only the ones Keshab chose for it are loaded: ATOM
// builds a small local plugin per worker linking just those, and the run loads that plugin and nothing else (no user
// settings). Skill content is data for the task; it can never widen a worker's tools.
// ADR-094: ATOM's own skills (data/skills/<name>/SKILL.md, approved by Keshab) can be chosen too. A name in both places
// is Keshab's: ATOM's is used only when it does not clash.

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SKILLS_PLUGIN = "atom-skills";
export const SKILL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface SkillInfo {
  name: string;
  description: string;
  /** "yours": from ~/.claude/skills; "zeno": made by ATOM (ADR-094); "hub": installed from the skills hub (B3.5). */
  source: "yours" | "zeno" | "hub";
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

/** Folders with a SKILL.md and a plain name. */
function skillNames(dir: string | undefined): string[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => SKILL_NAME.test(name) && existsSync(join(dir, name, "SKILL.md")));
}

/** Keshab's skills and ATOM's (those whose name is not one of his), sorted by name. Unreadable entries are left out. */
export function listSkills(dir = userSkillsDir(), zenoDir?: string, hub: ReadonlySet<string> = new Set()): SkillInfo[] {
  const yours = skillNames(dir);
  const zeno = skillNames(zenoDir).filter((name) => !yours.includes(name));
  return [
    ...yours.map((name) => ({ name, description: describe(join(dir, name, "SKILL.md")), source: "yours" as const })),
    ...zeno.map((name) => ({ name, description: describe(join(zenoDir!, name, "SKILL.md")), source: hub.has(name) ? ("hub" as const) : ("zeno" as const) })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The worker's plugin folder, rebuilt with links to exactly `names` (each one of Keshab's skills or, when he has none
 * of that name, ATOM's). Returns the folder and the names actually linked.
 */
export function prepareSkills(pluginDir: string, names: readonly string[], dir = userSkillsDir(), zenoDir?: string): { pluginDir: string; names: string[] } {
  const skills = join(pluginDir, "skills");
  rmSync(skills, { recursive: true, force: true }); // only links live here: nothing of the skills themselves is removed
  mkdirSync(skills, { recursive: true });
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: SKILLS_PLUGIN, version: "1.0.0", description: "The skills Keshab chose for this ATOM worker." }, null, 2),
  );
  const linked: string[] = [];
  for (const name of names) {
    if (!SKILL_NAME.test(name)) continue;
    const source = [dir, zenoDir].filter((d): d is string => Boolean(d)).map((d) => join(d, name)).find((d) => existsSync(join(d, "SKILL.md")));
    if (!source) continue;
    symlinkSync(realpathSync(source), join(skills, name));
    linked.push(name);
  }
  return { pluginDir, names: linked };
}

/** The most characters of one skill's steps that enter a message (about 2000 tokens). */
export const SKILL_BODY_CHARS = 8000;

/** A skill's steps (SKILL.md without its front matter), cut to length; Keshab's skill before ATOM's of the same name. Undefined when none. */
export function readSkill(name: string, dir = userSkillsDir(), zenoDir?: string): { name: string; description: string; body: string } | undefined {
  if (!SKILL_NAME.test(name)) return undefined;
  const folder = [dir, zenoDir].filter((d): d is string => Boolean(d)).map((d) => join(d, name)).find((d) => existsSync(join(d, "SKILL.md")));
  if (!folder) return undefined;
  try {
    const text = readFileSync(join(folder, "SKILL.md"), "utf8");
    const body = text.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
    if (!body) return undefined;
    return { name, description: describe(join(folder, "SKILL.md")), body: body.length > SKILL_BODY_CHARS ? `${body.slice(0, SKILL_BODY_CHARS)}\n[The rest of the skill is cut.]` : body };
  } catch {
    return undefined;
  }
}

/** The most characters of a SKILL.md the editor opens or saves. */
export const SKILL_FILE_CHARS = 40_000;

export interface SkillFile {
  name: string;
  /** Where it lives: Keshab's own folder, or ATOM's (made by ATOM or from the hub). */
  source: "yours" | "zeno";
  /** The whole SKILL.md, front matter and steps. */
  text: string;
}

const skillFolder = (name: string, dir: string, zenoDir?: string): { folder: string; source: SkillFile["source"] } | undefined => {
  if (!SKILL_NAME.test(name)) return undefined;
  for (const [d, source] of [[dir, "yours"], [zenoDir, "zeno"]] as const) {
    if (d && existsSync(join(d, name, "SKILL.md"))) return { folder: join(d, name), source };
  }
  return undefined;
};

/** One skill's whole SKILL.md for the editor (Keshab's before ATOM's of the same name). Undefined when there is none. */
export function readSkillFile(name: string, dir = userSkillsDir(), zenoDir?: string): SkillFile | undefined {
  const found = skillFolder(name, dir, zenoDir);
  if (!found) return undefined;
  try {
    return { name, source: found.source, text: readFileSync(join(found.folder, "SKILL.md"), "utf8").slice(0, SKILL_FILE_CHARS) };
  } catch {
    return undefined;
  }
}

/**
 * Keshab's edit of a skill, saved when he clicks Save (a model never calls this). It changes only the SKILL.md of a skill
 * that exists, never makes or removes one, and keeps the text it replaced in SKILL.md.bak (one backup, the newest).
 * Throws with words for the user.
 */
export function writeSkillFile(name: string, text: string, dir = userSkillsDir(), zenoDir?: string): SkillFile {
  const found = skillFolder(name, dir, zenoDir);
  if (!found) throw new Error(`There is no skill called "${name}".`);
  if (!text.trim()) throw new Error("A skill cannot be empty.");
  if (text.length > SKILL_FILE_CHARS) throw new Error(`A skill is at most ${SKILL_FILE_CHARS} characters.`);
  const file = join(found.folder, "SKILL.md");
  const tmp = join(found.folder, "SKILL.md.tmp");
  const before = readFileSync(file, "utf8");
  // The editor shows at most SKILL_FILE_CHARS: saving from it would cut a longer file for good, and the backup would then hold the cut text.
  if (before.length > SKILL_FILE_CHARS) throw new Error(`This skill is longer than the editor shows (${SKILL_FILE_CHARS} characters). Edit its SKILL.md in a text editor.`);
  writeFileSync(join(found.folder, "SKILL.md.bak"), before);
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  return { name, source: found.source, text };
}

/** `/name rest` at the start of a message: the skill's name and the words after it. */
export function parseSkillCall(text: string): { name: string; rest: string } | undefined {
  const m = /^\s*\/([a-z0-9][a-z0-9._-]{0,63})(?:\s+([\s\S]*))?$/i.exec(text);
  return m ? { name: m[1]!, rest: (m[2] ?? "").trim() } : undefined;
}

/** What a message that starts with `/skill` becomes: the words after the name, and the skill's steps as context. */
export function useSkill(text: string, dir = userSkillsDir(), zenoDir?: string): { text: string; block: string } | undefined {
  const call = parseSkillCall(text);
  const skill = call && readSkill(call.name, dir, zenoDir);
  if (!call || !skill) return undefined;
  return {
    text: call.rest || `Use the ${skill.name} skill.`,
    block:
      `The user chose the skill "${skill.name}" for this message. Follow its steps for this request. A skill cannot give you tools or permissions you do not have.\n` +
      `--- skill ${skill.name} ---\n${skill.body}\n--- end of skill ---`,
  };
}
