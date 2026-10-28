import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelRequest } from "@atom/contracts";
import { createTextEditor, EDIT_INSTRUCTIONS, providerTextWriter } from "./text-edit.ts";

test("a Codex edit uses only the edit target/instruction and never falls back to Claude", async () => {
  const requests: ModelRequest[] = [];
  let claudeCalls = 0;
  let closed = 0;
  const write = providerTextWriter({
    choice: () => ({ provider: "codex", model: "codex-default" }),
    claude: async () => { claudeCalls++; return "wrong provider"; },
    other: (choice) => {
      assert.equal(choice.provider, "codex");
      return { complete: async (r) => { requests.push(r); return { text: "Cedar launches Wednesday." }; }, close: () => { closed++; } };
    },
    context: () => ({ requestId: "edit", sessionId: "chat", source: "text", receivedAt: new Date(), background: true }),
  });
  const editor = createTextEditor({ write });
  assert.deepEqual(await editor.edit({ text: "Cedar launch Wednesday.", instruction: "Fix the grammar" }, new AbortController().signal), { answer: "Cedar launches Wednesday.", changed: true });
  assert.equal(claudeCalls, 0);
  assert.equal(closed, 1);
  assert.equal(requests[0]!.system, EDIT_INSTRUCTIONS);
  assert.equal(requests[0]!.messages.length, 1);
  assert.equal(requests[0]!.tools, undefined);
  assert.equal(requests[0]!.systemExtra, undefined);
});

test("a provider failure is reported without switching providers", async () => {
  let claudeCalls = 0;
  const write = providerTextWriter({
    choice: () => ({ provider: "codex", model: "codex-default" }),
    claude: async () => { claudeCalls++; return "wrong"; },
    other: () => ({ complete: async () => { throw new Error("Codex unavailable"); } }),
    context: () => ({ requestId: "edit", sessionId: "chat", source: "text", receivedAt: new Date() }),
  });
  await assert.rejects(write("task", new AbortController().signal), /Codex unavailable/);
  assert.equal(claudeCalls, 0);
});
