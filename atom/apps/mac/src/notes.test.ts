import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryStore } from "@atom/memory";
import type { LanguageModel, Message } from "@atom/contracts";
import type { ClaudeSdk } from "@atom/llm-gateway";
import { createNoteModel, createNotes } from "./notes.ts";

const convo = (n: number): Message[] => Array.from({ length: n }, (_, i) => [{ role: "user" as const, content: `q${i}` }, { role: "assistant" as const, content: `a${i}` }]).flat();
const log = { info: () => {}, warn: () => {} };

function setup(env: Record<string, string>, memory = openMemoryStore({ path: ":memory:" })) {
  const requests: unknown[] = [];
  const model: LanguageModel = { complete: async (r) => (requests.push(r), { text: "A note." }) };
  return { requests, memory, notes: createNotes({ memory, model, env, log, changed: () => {} }) };
}

test("ATOM_EPISODES=0 turns notes off; without memory there are none (ADR-108)", async () => {
  assert.equal(setup({ ATOM_EPISODES: "0" }).notes, undefined);
  assert.equal(createNotes({ memory: undefined, model: { complete: async () => ({ text: "" }) }, env: {}, log, changed: () => {} }), undefined);
});

test("ATOM_NOTE_QUIET_MS 0 restores a note after every reply; the default waits (ADR-108)", async () => {
  const each = setup({ ATOM_NOTE_QUIET_MS: "0" });
  each.notes!.update("s", convo(1));
  await each.notes!.idle();
  assert.equal(each.requests.length, 1);
  const waits = setup({});
  waits.notes!.update("s", convo(2));
  await waits.notes!.idle();
  assert.equal(waits.requests.length, 0, "waits for quiet");
  await waits.notes!.flush();
  assert.equal(waits.requests.length, 1);
});

test("the note runs on the small model even when the chat model is Opus or Sonnet (ADR-108), in one run without tools", async () => {
  const seen: Record<string, any>[] = [];
  const sdk = {
    query: ({ options }: { options: Record<string, any> }) => {
      seen.push(options);
      return (async function* () {
        yield { type: "system", subtype: "init", apiKeySource: "none" };
        yield { type: "result", subtype: "success", is_error: false, result: "", structured_output: { note: "A note." } };
      })();
    },
  } as unknown as ClaudeSdk;
  const model = createNoteModel({ claudePath: () => "/bin/claude", smallModel: () => "claude-haiku-5", sdk });
  const request = { system: "Write a note.", messages: [{ role: "user" as const, content: "The conversation" }], context: { requestId: "r", sessionId: "s", source: "text" as const, receivedAt: new Date() } };
  assert.equal((await model.complete(request)).text, "A note.");
  assert.deepEqual([seen[0]!.model, seen[0]!.tools, seen[0]!.persistSession], ["claude-haiku-5", [], false]);
  // No small model (not on the Claude plan): no note.
  const other = createNoteModel({ claudePath: () => "/bin/claude", smallModel: () => undefined, sdk });
  await assert.rejects(other.complete(request), /Claude plan/);
  assert.equal(seen.length, 1);
});
