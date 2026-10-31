import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IslandChats } from "./island-types.ts";

// Settings > Privacy > Chat history (2026-10-31): every saved chat as one Markdown file in a new folder the owner
// chose the place of. Only the words of the conversation are written; tool calls and results stay out.

/** A file name from a chat title: no path separators or control characters, at most 80 characters. */
export function chatFileName(index: number, title: string): string {
  const clean = title.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled chat";
  return `${String(index + 1).padStart(3, "0")} ${clean}.md`;
}

/** One chat as Markdown: its title, when it was last updated, then each message under who said it. */
export function chatMarkdown(title: string, updatedAt: string, messages: { role: string; content: string }[]): string {
  const lines = [`# ${title}`, "", `Last updated ${updatedAt}`, ""];
  for (const message of messages) {
    lines.push(message.role === "user" ? "## You" : "## ATOM", "", message.content.trim(), "");
  }
  return lines.join("\n");
}

/**
 * Writes every chat into `<parent>/ATOM chats <date>` (a new folder; "-2", "-3"… when one exists already).
 * `parent` is a full path the window chose. Returns the folder and how many chats were written.
 */
export function exportChats(chats: IslandChats, parent: string, now = new Date()): { folder: string; count: number } {
  if (!parent.startsWith("/") || parent.split("/").includes("..") || /[\x00-\x1f\x7f]/.test(parent)) throw new Error("Choose a folder on this Mac.");
  if (!existsSync(parent)) throw new Error("That folder no longer exists.");
  const base = join(parent, `ATOM chats ${now.toISOString().slice(0, 10)}`);
  let folder = base;
  for (let n = 2; existsSync(folder); n += 1) folder = `${base}-${n}`;
  mkdirSync(folder);
  const list = chats.list();
  list.forEach((chat, index) => {
    writeFileSync(join(folder, chatFileName(index, chat.title)), chatMarkdown(chat.title, chat.updatedAt, chats.messages(chat.id)), { flag: "wx" });
  });
  return { folder, count: list.length };
}

/** Deletes every saved chat. Returns how many went. */
export function clearChats(chats: IslandChats): number {
  let count = 0;
  for (const chat of chats.list()) if (chats.remove(chat.id)) count += 1;
  return count;
}
