import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@ark/helpers";
import { loadConfig, readEnv } from "@ark/shared";
import { createNativeCore } from "./native-core.ts";

// ADR-272 on the real Claude Code: a manager (Sid) gives work to its report (Kame) with the Agent tool. The child job
// must record the manager's job as its parent and its report must come back. The cloud tests use a fake SDK.
// Costs one short chat on the Claude plan. Run with: ARK_LIVE_TESTS=1 pnpm test:live
const enabled = readEnv(process.env, "ARK_LIVE_TESTS") === "1";
const MARKER = "MANGO-7731";

test("live: a manager hands work to its report, and the child job records its parent", { skip: !enabled && "set ARK_LIVE_TESTS=1 (pnpm test:live)", timeout: 300_000 }, async () => {
  const config = loadConfig();
  const dir = mkdtempSync(join(tmpdir(), "ark-team-live-"));
  const store = openHelperStore({ path: ":memory:", home: dir });
  try {
    const core = createNativeCore({
      claudePath: config.llm.apiKey,
      tools: { specs: () => [], run: async (call) => ({ callId: call.id, content: "No tools in this test.", isError: true }) },
      modelFor: () => config.llm.model,
      team: { helpers: store, approve: async () => false, worktrees: join(dir, "worktrees"), reportsTo: () => ({ kame: "sid" }) },
      timeoutMs: 240_000,
      idleMs: 20_000,
      log: (event, fields) => console.log(event, JSON.stringify(fields)),
    });
    await core.handle({
      text:
        `Test of ARK's team. Use the Agent tool once: subagent_type "sid", description "Get the code", prompt ` +
        `"Use the Agent tool to ask Kame (subagent_type kame) to reply with only the word ${MARKER}. Then report exactly what Kame said." ` +
        `When Sid has reported, answer in one short sentence.`,
      source: "text",
    });
    const deadline = Date.now() + 200_000;
    const jobs = () => store.list().flatMap((h) => h.jobs.map((j) => ({ ...j, helper: h.id })));
    let child: ReturnType<typeof jobs>[number] | undefined;
    while (Date.now() < deadline) {
      child = jobs().find((j) => j.helper === "kame");
      const parent = jobs().find((j) => j.helper === "sid");
      if (child && parent && ["done", "failed", "stopped"].includes(store.get(parent.id)!.state)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const parent = jobs().find((j) => j.helper === "sid");
    assert.ok(parent, "Sid got a Board job");
    assert.ok(child, `Kame got a Board job: ${JSON.stringify(jobs()).slice(0, 400)}`);
    assert.equal(store.get(child.id)!.parentId, parent.id, "the child job records the manager's job as its parent");
    const text = JSON.stringify(store.report(parent.id) ?? store.get(parent.id));
    assert.ok(text.includes(MARKER), `Kame's answer came back through Sid: ${text.slice(0, 300)}`);
    core.reset();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
