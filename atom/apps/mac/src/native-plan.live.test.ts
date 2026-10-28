import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHelperStore } from "@atom/helpers";
import { loadConfig, readEnv } from "@atom/shared";
import { createNativeCore } from "./native-core.ts";

// ADR-111 on the real Claude Code: the safety gate rewrites a planned portion's prompt, and the sub-agent must receive
// the rewritten one. The cloud tests cannot show this: they use a fake SDK. Costs one short chat on the Claude plan.
// Run with: ATOM_LIVE_TESTS=1 pnpm test:live
const enabled = readEnv(process.env, "ATOM_LIVE_TESTS") === "1";
const MARKER = "PINEAPPLE-4217";

test("live: a planned portion's stored task reaches the sub-agent, not the main agent's own words", { skip: !enabled && "set ATOM_LIVE_TESTS=1 (pnpm test:live)", timeout: 240_000 }, async () => {
  const config = loadConfig();
  const dir = mkdtempSync(join(tmpdir(), "atom-plan-live-"));
  const store = openHelperStore({ path: ":memory:", home: dir });
  try {
    const core = createNativeCore({
      claudePath: config.llm.apiKey,
      tools: { specs: () => [], run: async (call) => ({ callId: call.id, content: "No tools in this test.", isError: true }) },
      modelFor: () => config.llm.model,
      team: { helpers: store, approve: async () => false, worktrees: join(dir, "worktrees") },
      timeoutMs: 200_000,
      idleMs: 20_000, // the session closes soon after the last turn, so the test run can end
      log: (event, fields) => console.log(event, JSON.stringify(fields)),
    });
    await core.handle({
      text:
        `Test of ATOM's plan tools. Do exactly this: 1) Call plan_work with goal "Say a word" and one portion {agent: "Sid", task: "Reply with only the word ${MARKER} and nothing else."}. ` +
        `2) Start portion P1 with the Agent tool: description "P1", subagent_type "sid", prompt "Reply with only the word BANANA." 3) When the agent has reported, answer in one short sentence.`,
      source: "text",
    });
    // The agent runs in the background: wait until the Board job ends.
    const deadline = Date.now() + 150_000;
    const chat = core.sessionId;
    let job: number | undefined;
    while (Date.now() < deadline) {
      job = store.latestPlan(chat)?.portions[0]?.job;
      if (job !== undefined && ["done", "failed", "stopped"].includes(store.get(job)!.state)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    assert.ok(job !== undefined, "the portion became a Board job");
    const report = store.report(job);
    const text = JSON.stringify(report ?? store.get(job));
    assert.ok(text.includes(MARKER), `the sub-agent received the plan's task: ${text.slice(0, 300)}`);
    assert.ok(!text.includes("BANANA"), "the main agent's own prompt was replaced");
    core.reset(); // closes the session
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
