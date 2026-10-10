import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HelperError, type Soul } from "./jobs.ts";

// ADR-088: agents Keshab adds, each a folder with a soul.md: front matter (name, role, kit) and the soul's sections.

/** What an agent may use, fixed in code: the web, granted folders, or nothing. */
export type Kit = "research" | "folders" | "think";
export const KITS: readonly Kit[] = ["research", "folders", "think"];
export const MAX_ROLE_CHARS = 40;
export const MAX_AGENTS = 20;
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const SECTIONS: [keyof Soul, string][] = [
  ["personality", "Personality"],
  ["howItWorks", "How it works"],
  ["rules", "Rules"],
  ["lessons", "Lessons"],
];

export interface AgentFile {
  id: string;
  role: string;
  kit: Kit;
  soul: Soul;
}

/** A role in Keshab's words, checked: letters, spaces and hyphens, at most 40 characters, not Tinker's. */
export function cleanRole(raw: string): string {
  const role = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!role) throw new HelperError("The role is empty.");
  if (role.length > MAX_ROLE_CHARS) throw new HelperError(`The role is too long (limit ${MAX_ROLE_CHARS} characters).`);
  if (!/^\p{L}[\p{L} '-]*$/u.test(role)) throw new HelperError("A role needs letters only (spaces and hyphens are fine).");
  if (role === "improver") throw new HelperError("That role is Tinker's.");
  return role;
}

/** The folder name for a new agent: its name in lower case, letters and digits, unique among `taken`. */
export function agentId(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent";
  const start = /^[a-z]/.test(base) ? base : `a-${base}`;
  let id = start;
  for (let n = 2; taken.includes(id); n++) id = `${start}-${n}`;
  return id;
}

/** soul.md as text. */
export function formatSoulMd(agent: Omit<AgentFile, "id">): string {
  const front = `---\nname: ${agent.soul.name}\nrole: ${agent.role}\nkit: ${agent.kit}\n---\n`;
  return front + SECTIONS.map(([key, title]) => `\n## ${title}\n${agent.soul[key]}\n`).join("");
}

/** soul.md read back. Missing sections are empty; an unknown kit reads as think (no tools). Throws HelperError when unreadable. */
export function parseSoulMd(id: string, text: string): AgentFile {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text.replace(/\r\n?/g, "\n"));
  if (!m) throw new HelperError(`${id}/soul.md needs front matter (name, role, kit) between --- lines.`);
  const front = Object.fromEntries(
    m[1]!.split("\n").flatMap((line) => {
      const kv = /^(\w+)\s*:\s*(.*)$/.exec(line.trim());
      return kv ? [[kv[1]!.toLowerCase(), kv[2]!.trim().replace(/^["']|["']$/g, "")]] : [];
    }),
  ) as Record<string, string>;
  const sections = new Map<string, string>();
  let current: string | undefined;
  const lines: string[] = [];
  const flush = () => {
    if (current) sections.set(current, lines.join("\n").trim());
    lines.length = 0;
  };
  for (const line of m[2]!.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      current = heading[1]!.toLowerCase();
    } else lines.push(line);
  }
  flush();
  const kit = (KITS as readonly string[]).includes(front.kit ?? "") ? (front.kit as Kit) : "think";
  const soul = Object.fromEntries([["name", front.name ?? ""], ...SECTIONS.map(([key, title]) => [key, sections.get(title.toLowerCase()) ?? ""])]) as unknown as Soul;
  return { id, role: front.role ?? "", kit, soul };
}

/** Every agent folder with a readable soul.md, by folder name. Unreadable ones are skipped (and named in `problems`). */
export function loadAgents(dir: string): { agents: AgentFile[]; problems: string[] } {
  if (!existsSync(dir)) return { agents: [], problems: [] };
  const agents: AgentFile[] = [];
  const problems: string[] = [];
  for (const id of readdirSync(dir).sort()) {
    const file = join(dir, id, "soul.md");
    if (!ID.test(id) || !existsSync(file)) continue;
    try {
      agents.push(parseSoulMd(id, readFileSync(file, "utf8")));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { agents: agents.slice(0, MAX_AGENTS), problems };
}

export function writeAgent(dir: string, agent: AgentFile): void {
  if (!ID.test(agent.id)) throw new HelperError("That is not an agent's folder name.");
  mkdirSync(join(dir, agent.id), { recursive: true });
  writeFileSync(join(dir, agent.id, "soul.md"), formatSoulMd(agent));
}

/** Moves an agent's folder out of the team, to `agents-removed/` beside it. Never deletes. */
export function retireAgent(dir: string, id: string, at: Date): void {
  if (!ID.test(id) || !existsSync(join(dir, id))) throw new HelperError("There is no such agent.");
  const removed = join(dirname(dir), "agents-removed");
  mkdirSync(removed, { recursive: true });
  renameSync(join(dir, id), join(removed, `${id}-${at.toISOString().replace(/[:.]/g, "-")}`));
}
