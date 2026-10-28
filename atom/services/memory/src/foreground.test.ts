import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openMemoryStore } from "./store.ts";

test("long human question answers survive recovery and keep their exact receipt identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "atom-long-answer-")), path = join(dir, "memory.db");
  let memory = openMemoryStore({ path });
  const id = "00000000-0000-4000-8000-000000000001", card = "00000000-0000-4000-8000-000000000002";
  const answer = "Fictional Cedar instructions 日本語.\n".repeat(1500);
  try {
    memory.foreground.prepare({ id, chat: "cedar", text: "Ask a fictional question", files: [], notes: [], source: "text" });
    assert.equal(memory.foreground.start(id, "cedar"), true);
    memory.foreground.answer(id, card, "Which instructions?", answer);
    memory.close(); memory = openMemoryStore({ path });
    assert.equal(memory.foreground.get(id)?.answers[0]?.answer, answer);
    const digest = createHash("sha256").update(answer).digest("hex");
    assert.deepEqual(memory.foreground.knownAnswers([{ id: card, digest }]), [card]);
    assert.throws(() => memory.foreground.answer(id, card, "Which instructions?", answer + "changed"), /different answer/);
  } finally { memory.close(); rmSync(dir, { recursive: true, force: true }); }
});
