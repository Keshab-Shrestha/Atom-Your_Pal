import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_NAME } from "./skills.ts";

export const OMH_SKILLS_ROOT = fileURLToPath(new URL("../../../assets/skills/omh/", import.meta.url));
const safePath = (value: unknown): value is string => typeof value === "string" && value.length <= 240
  && !isAbsolute(value) && value.split("/").every((part) => /^[a-zA-Z0-9._-]+$/.test(part) && part !== "." && part !== "..");

/** Seed ATOM-owned copies once. Never synchronize over edits, remove skills or write Claude's global directory. */
export function installBundledSkills(destination: string, source = OMH_SKILLS_ROOT): { installed: number; retained: number } {
  const catalog = JSON.parse(readFileSync(join(source, "catalog.json"), "utf8"));
  if (catalog?.schema !== "atom.bundled-skills/v1" || !Array.isArray(catalog.skills) || catalog.skills.length > 500) throw new Error("Invalid bundled skill catalog.");
  const names = new Set<string>();
  for (const skill of catalog.skills) {
    if (typeof skill.name !== "string" || !SKILL_NAME.test(skill.name) || names.has(skill.name)
      || !Array.isArray(skill.files) || skill.files.length > 1000 || !skill.files.some((f: { path: unknown }) => f.path === "SKILL.md")) throw new Error("Invalid bundled skill entry.");
    names.add(skill.name);
    const paths = new Set<string>();
    for (const file of skill.files) {
      if (!safePath(file.path) || paths.has(file.path) || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid bundled skill material.");
      paths.add(file.path);
    }
  }
  if (existsSync(destination) && (!lstatSync(destination).isDirectory() || lstatSync(destination).isSymbolicLink())) throw new Error("ATOM's skills destination must be a normal directory.");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const root = realpathSync(source);
  let installed = 0, retained = 0;
  for (const skill of catalog.skills) {
    const target = join(destination, skill.name);
    // A broken symlink is an existing entry too; do not replace it.
    try { lstatSync(target); retained++; continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const staging = mkdtempSync(join(destination, `.${skill.name}-seed-`));
    try {
      for (const file of skill.files) {
        const original = join(root, skill.name, file.path);
        const canonical = realpathSync(original);
        const within = relative(root, canonical);
        const stat = lstatSync(original);
        if (within.startsWith(`..${sep}`) || within === ".." || isAbsolute(within) || !stat.isFile() || stat.nlink !== 1 || stat.size > 512 * 1024) throw new Error("Unsafe bundled skill material.");
        const bytes = readFileSync(original);
        if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Bundled skill checksum mismatch.");
        const output = join(staging, file.path);
        mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
        writeFileSync(output, bytes, { mode: 0o600, flag: "wx" });
      }
      // Publish the complete folder only; a failed copy is never visible as a skill.
      renameSync(staging, target);
      installed++;
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  return { installed, retained };
}
