import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryStore } from "./store.ts";

test("thinking persists before the first answer, is scoped to chat/provider/model, forks explicitly and deletes with chat", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-thinking-")), path = join(dir, "memory.db");
  let memory = openMemoryStore({ path });
  try {
    memory.chats.setReasoning("cedar", "codex", "gpt-test", "medium");
    memory.close(); memory = openMemoryStore({ path });
    assert.equal(memory.chats.reasoning("cedar", "codex", "gpt-test"), "medium");
    assert.equal(memory.chats.reasoning("other", "codex", "gpt-test"), undefined);
    assert.equal(memory.chats.reasoning("cedar", "claude-plan", "gpt-test"), undefined);
    assert.equal(memory.chats.reasoning("cedar", "codex", "different"), undefined);
    const turns = [{ role: "user" as const, content: "Cedar Wednesday" }, { role: "assistant" as const, content: "Noted" }];
    memory.chats.save("cedar", turns);
    memory.chats.setBrief("cedar", "Keep Wednesday", 0);
    memory.chats.fork("cedar", "fork-cedar", 2, "fork", "revision");
    assert.equal(memory.chats.reasoning("fork-cedar", "codex", "gpt-test"), "medium");
    memory.chats.setReasoning("fork-cedar", "codex", "gpt-test", "high");
    assert.equal(memory.chats.reasoning("cedar", "codex", "gpt-test"), "medium");
    assert.deepEqual(memory.chats.messages("cedar"), turns);
    assert.equal(memory.chats.brief("cedar")!.text, "Keep Wednesday");
    memory.chats.remove("fork-cedar");
    assert.equal(memory.chats.reasoning("fork-cedar", "codex", "gpt-test"), undefined);
    memory.chats.setReasoning("cedar", "codex", "gpt-test", undefined);
    assert.equal(memory.chats.reasoning("cedar", "codex", "gpt-test"), undefined);
  } finally { memory.close(); rmSync(dir, { recursive: true, force: true }); }
});
