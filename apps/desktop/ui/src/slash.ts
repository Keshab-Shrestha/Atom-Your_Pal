// The "/" picker in the message box (ADR-117): ATOM's own commands, skills and Claude commands in one list. A port of SlashMenu.swift.
// Pure, so it is tested without a window. The runtime decides what a skill or a command does; the window only completes the name.

export interface SkillInfo {
  name: string;
  description: string;
}

/** One of the user's Claude commands (~/.claude/commands/<name>.md) as the runtime lists it. */
export interface SlashCommandInfo {
  name: string;
  description: string;
  /** The front matter's `argument-hint`, such as "[file]"; empty when there is none. */
  hint: string;
}

/** What an ATOM command does. The window runs these itself; they never reach the model. */
export type SlashAction = "newChat" | "model" | "skills" | "memory" | "help";

export type SlashSource = "atom" | "skill" | "command";

export interface SlashItem {
  /** Unique in the list: the source and the name. */
  id: string;
  name: string;
  detail: string;
  /** The argument hint ("[file]"), shown after the name. */
  hint: string;
  source: SlashSource;
  /** Set for ATOM's own commands. */
  action?: SlashAction;
}

const RANK: Record<SlashSource, number> = { atom: 0, skill: 1, command: 2 };

export const SOURCE_LABEL: Record<SlashSource, string> = { atom: "ATOM", skill: "Skill", command: "Command" };

const item = (name: string, detail: string, source: SlashSource, hint = "", action?: SlashAction): SlashItem => ({
  id: `${RANK[source]}-${name}`,
  name,
  detail,
  hint,
  source,
  ...(action ? { action } : {}),
});

export const BUILT_INS: readonly SlashItem[] = [
  item("new", "Start a new chat", "atom", "", "newChat"),
  item("model", "Choose the AI model", "atom", "", "model"),
  item("skills", "See and edit your skills", "atom", "", "skills"),
  item("memory", "See what ATOM remembers", "atom", "", "memory"),
  item("help", "Show every command", "atom", "", "help"),
];

/** The most rows the picker lists. */
export const SLASH_LIMIT = 8;

export const title = (it: SlashItem) => `/${it.name}`;

/** The draft is a command name being typed: it starts with "/" and has no white space yet. */
export function isPicking(draft: string): boolean {
  return draft.startsWith("/") && !/\s/u.test(draft);
}

/** Every command that can be run, once each. A name that ATOM itself uses is ATOM's; else a skill's; else a command's. */
export function allItems(skills: readonly SkillInfo[], commands: readonly SlashCommandInfo[]): SlashItem[] {
  const taken = new Set(BUILT_INS.map((b) => b.name));
  const items = [...BUILT_INS];
  for (const skill of skills) {
    if (taken.has(skill.name)) continue;
    taken.add(skill.name);
    items.push(item(skill.name, skill.description, "skill"));
  }
  for (const command of commands) {
    if (taken.has(command.name)) continue;
    taken.add(command.name);
    items.push(item(command.name, command.description, "command", command.hint));
  }
  return items;
}

/**
 * The rows for what is typed: names that start with it first, then names that contain it, then descriptions that do. Within a group
 * ATOM's commands come first, then skills, then commands, then by name. Empty unless the draft is a name being typed.
 */
export function itemsFor(draft: string, skills: readonly SkillInfo[], commands: readonly SlashCommandInfo[]): SlashItem[] {
  if (!isPicking(draft)) return [];
  const query = draft.slice(1).toLowerCase();
  const ranked: { it: SlashItem; rank: number }[] = [];
  for (const it of allItems(skills, commands)) {
    const name = it.name.toLowerCase();
    if (query === "" || name.startsWith(query)) ranked.push({ it, rank: 0 });
    else if (name.includes(query)) ranked.push({ it, rank: 1 });
    else if (it.detail.toLowerCase().includes(query)) ranked.push({ it, rank: 2 });
  }
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return ranked
    .sort((a, b) => a.rank - b.rank || RANK[a.it.source] - RANK[b.it.source] || order(a.it.name, b.it.name))
    .map((r) => r.it)
    .slice(0, SLASH_LIMIT);
}

/** What the draft becomes when a skill or a command is picked: its name and a space, ready for the words. */
export const completion = (it: SlashItem): string => `/${it.name} `;

/** The ATOM command the draft names in full ("/new", "/memory"), with the words after it. Undefined for anything else, which goes to ATOM as a message. */
export function builtInIn(draft: string): { action: SlashAction; rest: string } | undefined {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/u.exec(draft.trim());
  if (!match) return undefined;
  const found = BUILT_INS.find((b) => b.name === match[1]!.toLowerCase());
  return found?.action ? { action: found.action, rest: match[2] ?? "" } : undefined;
}

/**
 * Why an ATOM command cannot be run in this window yet; undefined when it can. Commands that open a page say so instead of doing
 * nothing. They are listed so the picker matches the Mac app's, and each starts working when its page is ported.
 */
export function unavailable(action: SlashAction): string | undefined {
  switch (action) {
    case "model":
      return "Choose the model with the model button under the message box.";
    case "skills":
      return "Skills are not in this window yet. Open them in the Mac app's Plugins.";
    case "memory":
      return "The Second brain is not in this window yet. Open it in the Mac app.";
    default:
      return undefined;
  }
}
