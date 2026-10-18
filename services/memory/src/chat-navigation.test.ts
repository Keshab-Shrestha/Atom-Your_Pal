import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMemoryStore } from "./store.ts";

const turns = [{ role: "user" as const, content: "Fictional Juniper" }, { role: "assistant" as const, content: "Outline" }];

test("window selection persists separately from chat recency and explicit fresh-start intent", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-window-selection-")), path = join(dir, "memory.db");
  let memory = openMemoryStore({ path });
  try {
    assert.equal(memory.chats.lastOpened(), undefined);
    memory.chats.save("juniper", turns); memory.chats.rememberOpened("juniper");
    memory.chats.save("background", turns);
    memory.close(); memory = openMemoryStore({ path });
    assert.equal(memory.chats.lastOpened(), "juniper");
    assert.deepEqual(memory.chats.messages("juniper"), turns);
    memory.chats.rememberOpened(undefined);
    memory.close(); memory = openMemoryStore({ path });
    assert.equal(memory.chats.lastOpened(), undefined);
    assert.deepEqual(memory.chats.messages("juniper"), turns);
    assert.throws(() => memory.chats.rememberOpened("not-saved"), /available saved chat/);
  } finally { memory.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("deletion and retention remove a selection without choosing a different chat", () => {
  const memory = openMemoryStore({ path: ":memory:" });
  try {
    memory.chats.save("deleted", turns); memory.chats.rememberOpened("deleted"); memory.chats.remove("deleted");
    assert.equal(memory.chats.lastOpened(), undefined);
    memory.chats.save("oldest", turns); memory.chats.rememberOpened("oldest");
    for (let n = 0; n < 201; n++) memory.chats.save(`new-${n}`, turns);
    assert.equal(memory.chats.metadata("oldest"), undefined);
    assert.equal(memory.chats.lastOpened(), undefined);
    const id = memory.chats.list()[0]!.id;
    memory.chats.setFlags(id, { archived: true }, 0);
    assert.throws(() => memory.chats.rememberOpened(id), /available saved chat/);
  } finally { memory.close(); }
});
