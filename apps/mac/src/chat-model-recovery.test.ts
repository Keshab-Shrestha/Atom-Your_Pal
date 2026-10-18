import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryStore } from "@atom/memory";
import { openHelperStore } from "@atom/helpers";
import { retrySourceChat } from "./native-entry.ts";

test("a first-turn interruption retains the chat's provider for its explicit retry before any transcript was saved", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-chat-model-recovery-"));
  const choice = { provider: "codex", model: "codex-default" };
  let memory = openMemoryStore({ path: join(dir, "memory.db") });
  let helpers = openHelperStore({ path: join(dir, "helpers.db") });
  try {
    assert.equal(memory.chats.setModel("first-turn", choice), false);
    assert.deepEqual(memory.chats.list(), [], "a model choice does not invent a saved transcript");
    const old = helpers.addNativeJob("kame", "Finish fictional Cedar", { chatId: "first-turn" });
    memory.close(); helpers.close();
    memory = openMemoryStore({ path: join(dir, "memory.db") });
    helpers = openHelperStore({ path: join(dir, "helpers.db") });
    const attempt = helpers.queueNativeRetry(old.id).job;
    const source = retrySourceChat(helpers, attempt.chatId!);
    assert.equal(source, "first-turn");
    assert.deepEqual(memory.chats.model(source!), choice);
    assert.deepEqual(memory.chats.messages(source!), []);
    assert.equal(memory.chats.model("unrelated"), undefined);
    memory.chats.save(source!, [{ role: "user", content: "Cedar" }, { role: "assistant", content: "Finished" }]);
    memory.close(); memory = openMemoryStore({ path: join(dir, "memory.db") });
    assert.deepEqual(memory.chats.model(source!), choice, "first save promotes the choice without losing it");
    assert.equal(memory.chats.setModel(source!, { provider: "claude-plan", model: "claude-sonnet-5-5" }), true);
    assert.equal(memory.chats.model(source!)?.provider, "claude-plan", "a later explicit choice still wins");
    memory.chats.setModel(source!, undefined);
    assert.equal(memory.chats.model(source!), undefined);
  } finally { memory.close(); helpers.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("resetting or removing an unsaved chat removes its durable pending model choice", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-pending-model-"));
  let memory = openMemoryStore({ path: join(dir, "memory.db") });
  try {
    for (const id of ["reset", "remove", "keep"]) memory.chats.setModel(id, { provider: "codex", model: "codex-default" });
    memory.chats.setModel("reset", undefined);
    memory.chats.remove("remove");
    memory.close(); memory = openMemoryStore({ path: join(dir, "memory.db") });
    assert.equal(memory.chats.model("reset"), undefined);
    assert.equal(memory.chats.model("remove"), undefined);
    assert.equal(memory.chats.model("keep")?.provider, "codex");
    assert.deepEqual(memory.chats.list(), []);
  } finally { memory.close(); rmSync(dir, { recursive: true, force: true }); }
});
