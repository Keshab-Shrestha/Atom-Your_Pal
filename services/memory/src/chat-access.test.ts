import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryStore } from "./store.ts";

test("access survives restart before first reply, forks independently, and preserves history, brief and exact-file permissions", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-access-")), path = join(dir, "memory.db");
  let memory = openMemoryStore({ path });
  try {
    assert.equal(memory.chats.access("cedar"), "checked");
    memory.chats.setAccess("cedar", "chat-only");
    memory.close(); memory = openMemoryStore({ path });
    assert.equal(memory.chats.access("cedar"), "chat-only");
    assert.equal(memory.chats.access("other"), "checked");
    const turns = [{ role: "user" as const, content: "Cedar" }, { role: "assistant" as const, content: "Wednesday" }];
    memory.chats.save("cedar", turns); memory.chats.setBrief("cedar", "Keep Wednesday", 0);
    memory.filePermissions.forChat("cedar").grant(join(dir, "page.txt"));
    memory.chats.setAccess("cedar", "ask-changes");
    memory.chats.fork("cedar", "cedar-fork", 2, "fork", "revision");
    assert.equal(memory.chats.access("cedar-fork"), "ask-changes");
    memory.chats.setAccess("cedar-fork", "chat-only");
    assert.equal(memory.chats.access("cedar"), "ask-changes");
    memory.chats.setAccess("cedar", "checked");
    assert.deepEqual(memory.chats.messages("cedar"), turns);
    assert.equal(memory.chats.brief("cedar")!.text, "Keep Wednesday");
    assert.equal(memory.filePermissions.forChat("cedar").list().length, 1);
    memory.chats.remove("cedar-fork"); assert.equal(memory.chats.access("cedar-fork"), "checked");
    memory.chats.setAccess("unsaved", "chat-only"); memory.chats.remove("unsaved"); assert.equal(memory.chats.access("unsaved"), "checked");
    assert.throws(() => memory.chats.setAccess("cedar", "full" as any));
  } finally { memory.close(); rmSync(dir, { recursive: true, force: true }); }
});
