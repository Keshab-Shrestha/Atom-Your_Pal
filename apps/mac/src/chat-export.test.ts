import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@atom/contracts";
import { chatFileName, clearChats, exportChats } from "./chat-export.ts";
import { parseCommand } from "./island-protocol.ts";
import type { IslandChats } from "./island-types.ts";

/** A throwaway chat store: two fictional chats, kept in memory. */
function fakeChats(): IslandChats & { left: () => number } {
  const chats = new Map<string, { title: string; messages: Message[] }>([
    ["a1", { title: "Cedar launch plan", messages: [{ role: "user", content: "Help me prepare the Cedar launch." }, { role: "assistant", content: "Start with the outline." }] }],
    ["b2", { title: "What/is: on Thursday?", messages: [{ role: "user", content: "Anything on Thursday?" }] }],
  ]);
  return {
    list: () => [...chats].map(([id, chat]) => ({ id, title: chat.title, updatedAt: "2026-10-31T09:00:00.000Z", messages: chat.messages.length })),
    messages: (id) => chats.get(id)?.messages ?? [],
    remove: (id) => chats.delete(id),
    onChange: () => () => {},
    left: () => chats.size,
  };
}

test("every chat becomes one Markdown file in a new dated folder; a second export does not overwrite the first", () => {
  const parent = mkdtempSync(join(tmpdir(), "atom-chat-export-"));
  try {
    const chats = fakeChats();
    const first = exportChats(chats, parent, new Date("2026-10-31T10:00:00Z"));
    assert.equal(first.count, 2);
    assert.equal(first.folder, join(parent, "ATOM chats 2026-10-31"));
    assert.deepEqual(readdirSync(first.folder).sort(), ["001 Cedar launch plan.md", "002 What is on Thursday.md"]);
    const text = readFileSync(join(first.folder, "001 Cedar launch plan.md"), "utf8");
    assert.match(text, /^# Cedar launch plan\n\nLast updated 2026-10-31T09:00:00.000Z\n\n## You\n\nHelp me prepare the Cedar launch\.\n\n## ATOM\n\nStart with the outline\.\n/);
    const second = exportChats(chats, parent, new Date("2026-10-31T11:00:00Z"));
    assert.equal(second.folder, join(parent, "ATOM chats 2026-10-31-2"));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("export refuses a folder that is not a full path or does not exist", () => {
  assert.throws(() => exportChats(fakeChats(), "relative/folder"), /Choose a folder/);
  assert.throws(() => exportChats(fakeChats(), "/tmp/../etc"), /Choose a folder/);
  assert.throws(() => exportChats(fakeChats(), join(tmpdir(), "atom-no-such-folder-31")), /no longer exists/);
});

test("clear deletes every chat and says how many", () => {
  const chats = fakeChats();
  assert.equal(clearChats(chats), 2);
  assert.equal(chats.left(), 0);
});

test("file names drop path separators and control characters and keep a number for order", () => {
  assert.equal(chatFileName(0, "a/b\\c:d"), "001 a b c d.md");
  assert.equal(chatFileName(9, "  "), "010 Untitled chat.md");
});

test("the commands parse: export needs a full folder path, clear takes nothing", () => {
  assert.deepEqual(parseCommand(JSON.stringify({ type: "chats.export", folder: "/Users/k/Desktop" })), { command: { type: "chats.export", folder: "/Users/k/Desktop" } });
  assert.ok("error" in parseCommand(JSON.stringify({ type: "chats.export", folder: "Desktop" })));
  assert.deepEqual(parseCommand(JSON.stringify({ type: "chats.clear" })), { command: { type: "chats.clear" } });
});
