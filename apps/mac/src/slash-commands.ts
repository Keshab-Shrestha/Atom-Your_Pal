// 2026-10-15 (ADR-117): Claude Code's custom commands (~/.claude/commands/<name>.md) work in ATOM's chat. A message that starts
// with `/name some words` becomes the command's prompt with the words in place of `$ARGUMENTS`. The command is only a
// prompt: ATOM reads the file and never writes it, and it runs nothing. Lines that start with `!` (a shell command in Claude
// Code) are left as text and the model is told they were not run. A skill of the same name wins (skills.ts); a name that
// is not a plain file name never matches, so `/../x` reads nothing.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseSkillCall } from "./skills.ts";

/** A plain file name, as for a skill. */
export const COMMAND_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
/** The most characters of one command's prompt that enter a message (about 5000 tokens). */
export const COMMAND_BODY_CHARS = 20_000;

export interface CommandInfo {
  name: string;
  /** From the front matter's `description`, one line. */
  description: string;
  /** From the front matter's `argument-hint`, such as "[file]"; empty when there is none. */
  hint: string;
}

export const userCommandsDir = () => join(homedir(), ".claude", "commands");

/** A command file split into its front matter (`key: value` lines between `---` lines) and its prompt. */
function split(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(m[0].length) };
}

/** The command's name from a file name, or undefined when the file is not a command (not `.md`, or a name that is not plain). */
function nameOf(file: string): string | undefined {
  if (!file.endsWith(".md")) return undefined;
  const name = file.slice(0, -3);
  return COMMAND_NAME.test(name) ? name : undefined;
}

/** Keshab's commands, sorted by name. Unreadable files are left out. */
export function listCommands(dir = userCommandsDir()): CommandInfo[] {
  if (!existsSync(dir)) return [];
  const out: CommandInfo[] = [];
  for (const file of readdirSync(dir)) {
    const name = nameOf(file);
    if (!name) continue;
    try {
      const head = readFileSync(join(dir, file), "utf8").slice(0, 4000);
      const { meta } = split(head);
      out.push({ name, description: (meta.description ?? "").slice(0, 200), hint: (meta["argument-hint"] ?? "").slice(0, 60) });
    } catch {
      /* unreadable: not listed */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** One command's prompt (its front matter removed), cut to length; undefined when there is no such command. */
export function readCommand(name: string, dir = userCommandsDir()): { name: string; description: string; body: string } | undefined {
  if (!COMMAND_NAME.test(name)) return undefined;
  const file = join(dir, `${name}.md`);
  try {
    if (!existsSync(file) || !statSync(file).isFile()) return undefined;
    const { meta, body } = split(readFileSync(file, "utf8"));
    const text = body.trim();
    if (!text) return undefined;
    return { name, description: meta.description ?? "", body: text.length > COMMAND_BODY_CHARS ? `${text.slice(0, COMMAND_BODY_CHARS)}\n[The rest of the command is cut.]` : text };
  } catch {
    return undefined;
  }
}

/**
 * The prompt with the words filled in: `$ARGUMENTS` is all of them, `$1` to `$9` are the words one by one. A command with no
 * placeholder gets the words added at the end, so they are never lost.
 */
export function expandCommand(body: string, args: string): string {
  const words = args.trim().split(/\s+/).filter(Boolean);
  let used = false;
  let text = body.replace(/\$ARGUMENTS|\$([1-9])/g, (_, n: string | undefined) => {
    used = true;
    return n ? (words[Number(n) - 1] ?? "") : args.trim();
  });
  if (!used && args.trim()) text += `\n\nArguments: ${args.trim()}`;
  if (/^\s*!/m.test(text)) text = `Lines that start with "!" are shell commands in Claude Code. ATOM did not run them. Say so if one was needed.\n\n${text}`;
  return text;
}

/** What a message that starts with `/command` becomes: the command's prompt with its words, or undefined when it is no command. */
export function useCommand(text: string, dir = userCommandsDir()): { text: string; block: string } | undefined {
  const call = parseSkillCall(text);
  const command = call && readCommand(call.name, dir);
  if (!call || !command) return undefined;
  return { text: expandCommand(command.body, call.rest), block: "" };
}
