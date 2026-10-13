import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryStore } from "@atom/memory";
import type { LanguageModel, Message } from "@atom/contracts";
import { createNotes } from "./notes.ts";

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
