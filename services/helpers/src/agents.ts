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

/** ADR-095: a Manager plans and reviews (a short no-tools run) or is a group only (no model calls). */
export type ManagerMode = "plan" | "group";
export const MANAGER_MODES: readonly ManagerMode[] = ["plan", "group"];
export const MAX_MANAGERS = 12;

export interface AgentFile {
  id: string;
  role: string;
  kit: Kit;
  soul: Soul;
  /** ADR-095: an Agent's Manager (its folder name); absent: none yet. */
  manager?: string;
}

/** ADR-095: a Manager's soul.md: `kind: manager`, its mode, and a soul (no role, no kit, no manager of its own). */
export interface ManagerFile {
  id: string;
  mode: ManagerMode;
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
/** ADR-110: the ids of Claude Code's built-in agents, in lower case. A new agent's id is never one of them. */
export const RESERVED_AGENT_IDS: readonly string[] = ["general-purpose", "claude", "explore", "plan", "statusline-setup", "fork", "output-style-setup"];

export function agentId(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "agent";
  const start = /^[a-z]/.test(base) ? base : `a-${base}`;
  let id = start;
  for (let n = 2; taken.includes(id); n++) id = `${start}-${n}`;
  return id;
}

/** soul.md as text: an Agent's (name, role, kit, manager) or, ADR-095, a Manager's (name, kind, mode). */
/**
 * A line of soul text that starts with "## " would be read back as a section heading and cut the text there (2026-10-16). It is
 * written with a backslash in front, and a line that already starts with backslashes before "## " gets one more, so reading it
 * back removes exactly one and gives the original text.
 */
const escapeBody = (text: string) => text.replace(/^(\\*## )/gm, "\\$1");
const unescapeBody = (text: string) => text.replace(/^\\(\\*## )/gm, "$1");

export function formatSoulMd(agent: Omit<AgentFile, "id"> | Omit<ManagerFile, "id">): string {
  const front =
    "mode" in agent
      ? `---\nname: ${agent.soul.name}\nkind: manager\nmode: ${agent.mode}\n---\n`
      : `---\nname: ${agent.soul.name}\nrole: ${agent.role}\nkit: ${agent.kit}\n${agent.manager ? `manager: ${agent.manager}\n` : ""}---\n`;
  return front + SECTIONS.map(([key, title]) => `\n## ${title}\n${escapeBody(agent.soul[key])}\n`).join("");
}

/** soul.md read back. Missing sections are empty; an unknown kit reads as think (no tools). Throws HelperError when unreadable. */
export function parseSoulMd(id: string, text: string): AgentFile {
  const parsed = parseSoulFile(id, text);
  if ("mode" in parsed) throw new HelperError("That soul.md is a Manager's, not an Agent's.");
  return parsed;
}

/**
 * ADR-095: an Agent's or a Manager's soul.md. A Manager (`kind: manager`) has a mode (`plan` or `group`; anything else
 * reads as group) and may not have a kit or a manager of its own: such a file is refused, with why.
 */
export function parseSoulFile(id: string, text: string): AgentFile | ManagerFile {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text.replace(/\r\n?/g, "\n"));
  if (!m) throw new HelperError("soul.md needs front matter (name, role, kit) between --- lines."); // the folder is named beside it
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
    if (current) sections.set(current, unescapeBody(lines.join("\n")).trim());
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
  const soul = Object.fromEntries([["name", front.name ?? ""], ...SECTIONS.map(([key, title]) => [key, sections.get(title.toLowerCase()) ?? ""])]) as unknown as Soul;
  if (front.kind === "manager") {
    if (front.kit !== undefined) throw new HelperError("A Manager has no kit: its Agents do the work.");
    if (front.manager !== undefined) throw new HelperError("A Manager cannot be under another Manager.");
    if (front.role !== undefined) throw new HelperError("A Manager has no role: it runs a team of Agents.");
    return { id, mode: front.mode === "plan" ? "plan" : "group", soul };
  }
  if (front.kind !== undefined && front.kind !== "agent") throw new HelperError(`"kind" is agent or manager, not "${front.kind.slice(0, 20)}".`);
  const kit = (KITS as readonly string[]).includes(front.kit ?? "") ? (front.kit as Kit) : "think";
  return { id, role: front.role ?? "", kit, soul, ...(front.manager ? { manager: front.manager } : {}) };
}

/** An agent folder that could not be loaded: its folder name and why, in words (about the file, never a task). */
export interface AgentProblem {
  id: string;
  problem: string;
}

/**
 * Every agent folder with a readable soul.md, by folder name: Agents and, ADR-095, Managers. Unreadable ones are skipped
 * (and named in `problems`).
 */
export function loadAgents(dir: string): { agents: AgentFile[]; managers: ManagerFile[]; problems: AgentProblem[] } {
  if (!existsSync(dir)) return { agents: [], managers: [], problems: [] };
  const agents: AgentFile[] = [];
  const managers: ManagerFile[] = [];
  const problems: AgentProblem[] = [];
  for (const id of readdirSync(dir).sort()) {
    const file = join(dir, id, "soul.md");
    if (!ID.test(id) || !existsSync(file)) continue;
    try {
      const parsed = parseSoulFile(id, readFileSync(file, "utf8"));
      if ("mode" in parsed) managers.push(parsed);
      else agents.push(parsed);
    } catch (error) {
      problems.push({ id, problem: error instanceof Error ? error.message : String(error) });
    }
  }
  return { agents: agents.slice(0, MAX_AGENTS), managers: managers.slice(0, MAX_MANAGERS), problems };
}

export function writeAgent(dir: string, agent: AgentFile | ManagerFile): void {
  if (!ID.test(agent.id)) throw new HelperError("That is not an agent's folder name.");
  mkdirSync(join(dir, agent.id), { recursive: true });
  writeFileSync(join(dir, agent.id, "soul.md"), formatSoulMd(agent));
}

/** Moves an agent's (or a Manager's) folder out of the team, to `agents-removed/` beside it. Never deletes. */
export function retireAgent(dir: string, id: string, at: Date): void {
  if (!ID.test(id) || !existsSync(join(dir, id))) throw new HelperError("There is no such agent.");
  const removed = join(dirname(dir), "agents-removed");
  mkdirSync(removed, { recursive: true });
  renameSync(join(dir, id), join(removed, `${id}-${at.toISOString().replace(/[:.]/g, "-")}`));
}
