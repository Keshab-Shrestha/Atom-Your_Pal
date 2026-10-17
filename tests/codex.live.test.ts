import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProgram } from "../packages/shared/src/index.ts";
import { openHelperStore } from "../services/helpers/src/index.ts";
import { openMemoryStore } from "../services/memory/src/index.ts";
import { createGateway, createCodexSessionAdapter } from "../services/llm-gateway/src/index.ts";
import { createCodexToolRouter } from "../apps/mac/src/codex-tools.ts";
import { createNativeCore } from "../apps/mac/src/native-core.ts";
import type { ToolCall } from "../packages/contracts/src/index.ts";

test("live Codex: delegate a checked edit, retain chat context and reuse an explicit file grant in a later task", { skip: process.env.ATOM_LIVE_CODEX_TESTS !== "1" && "set ATOM_LIVE_CODEX_TESTS=1 to run the signed-in Codex workflow", timeout: 300_000 }, async () => {
  const program = findProgram("codex", "ATOM_CODEX_PATH");
  assert.ok(program, "Codex must be installed and signed in");
  const home = realpathSync(mkdtempSync(join(tmpdir(), "atom-codex-live-")));
  const helpers = openHelperStore({ path: ":memory:", home });
  const memory = openMemoryStore({ path: ":memory:" });
  const path = join(home, "launch.txt"); writeFileSync(path, "Cedar launches Tuesday.");
  let approvals = 0;
  const tools = { specs: () => [], run: async (c: ToolCall) => ({ callId: c.id, content: "ok" }) };
  const team = { helpers, worktrees: join(home, "worktrees"), filePermissions: memory.filePermissions, approve: async () => false, approveFile: async () => { approvals++; return "chat" as const; } };
  const router = createCodexToolRouter({ program, model: "codex-default", home, tools, team });
  const model = createGateway({ provider: createCodexSessionAdapter({ program, model: "codex-default", runner: (r) => router.forRequest(r) }), timeoutMs: 120_000, maxRetries: 0 });
  const core = createNativeCore({ claudePath: "", tools, team, modelFor: () => undefined, toolModel: () => model, onExchange: (id, turns) => memory.chats.save(id, turns), newId: () => "live-codex" });
  try {
    const first = await core.handle({ source: "text", text: `The fictional project is Cedar. Its new launch day is Wednesday. Kame, read ${path} and replace its entire content with exactly 'Cedar launches Wednesday.' using atom_Write. ATOM, return the actual worker's report.` });
    assert.match(readFileSync(path, "utf8"), /^Cedar launches Wednesday\.\s*$/);
    assert.equal(approvals, 1);
    assert.ok(helpers.list().flatMap((h) => h.jobs).some((j) => j.state === "done"), first.text);
    const second = await core.handle({ source: "text", text: "What project and new launch day did we agree on? Don't use any tool." });
    assert.match(second.text, /Cedar/); assert.match(second.text, /Wednesday/i);
    const third = await core.handle({ source: "text", text: `Kame, rewrite that same file to exactly 'Cedar launches Wednesday. Doors open at noon.' ATOM, report when the worker has actually saved it.` });
    assert.match(readFileSync(path, "utf8"), /Doors open at noon/, JSON.stringify({ reply: third.text, jobs: helpers.list().flatMap((h) => h.jobs).map((j) => ({ id: j.id, state: j.state, error: j.error, report: helpers.report(j.id)?.body })) }));
    assert.equal(approvals, 1, "the second task must reuse only the explicit grant for this chat/file");
    assert.equal(memory.chats.messages("live-codex").length, 6);
    assert.ok(helpers.list().flatMap((h) => h.jobs).filter((j) => j.state === "done").length >= 2, third.text);
  } finally { router.close(); model.close?.(); helpers.close(); memory.close(); rmSync(home, { recursive: true, force: true }); }
});
