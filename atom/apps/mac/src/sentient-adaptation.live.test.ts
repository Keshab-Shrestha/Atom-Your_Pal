import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { findClaudeProgram, findCodexProgram, readEnv } from "@atom/shared";
import { createGateway, createCodexSessionAdapter, listPlanModels, runEdit } from "@atom/llm-gateway";
import { continuityItems } from "@atom/memory";
import { REPLY_INSTRUCTIONS } from "./reply-drafts.ts";
import { CONTINUITY_INSTRUCTIONS } from "./chat-continuity.ts";
import { PREPARATION_INSTRUCTIONS, preparationInput, preparedBriefOutput } from "./prepared-brief.ts";
import { SOURCE_ANALYSIS_INSTRUCTIONS } from "./source-analysis.ts";

// Explicit end-of-plan live smoke only: fictional text, no runtime/store/app, tools or external actions.
const enabled = readEnv(process.env, "ATOM_LIVE_TESTS") === "1";
for (const provider of ["claude-plan", "codex"] as const) {
  test(`live adaptation: ${provider} returns the four isolated output contracts`, { skip: !enabled, timeout: 300_000 }, async (t) => {
    const program = provider === "claude-plan" ? findClaudeProgram() : findCodexProgram();
    if (!program) { t.skip("The signed-in provider program is not installed."); return; }
    const model = provider === "claude-plan" ? (await listPlanModels(program, { timeoutMs: 15_000 })).find((model) => /haiku/i.test(model.id + model.name))?.id : "gpt-6-luna";
    if (!model) { t.skip("No small Claude model was advertised; no alternative model was chosen."); return; }
    const profile = { provider, model };
    async function write(instructions: string, task: string, stage: string) {
      const start = performance.now(); let text: string;
      if (provider === "claude-plan") {
        text = (await runEdit({ claudePath: program!, model: model!, instructions, task, signal: AbortSignal.timeout(60_000), maxTurns: 4 })).text;
      } else {
        const gateway = createGateway({ provider: createCodexSessionAdapter({ program: program!, model: model!, runner: () => ({ specs: () => [], run: async () => { throw new Error("No tools in this fixture"); } }) }), timeoutMs: 60_000, maxRetries: 0 });
        try { text = (await gateway.complete({ access: "chat-only", reasoning: "low", system: instructions, messages: [{ role: "user", content: task }],
          context: { requestId: randomUUID(), sessionId: randomUUID(), source: "text", receivedAt: new Date(), background: true } })).text; }
        finally { gateway.close?.(); }
      }
      t.diagnostic(JSON.stringify({ provider, model, stage, durationMs: Math.round(performance.now() - start), inputBytes: Buffer.byteLength(task), outputBytes: Buffer.byteLength(text) }));
      return text;
    }
    const draft = await write(REPLY_INSTRUCTIONS, JSON.stringify({ intent: "Accept Wednesday without promising a time.", conversation: "Can we hold the fictional Cedar launch on Wednesday?", background: "", sources: [], writingExamples: "" }), "reply");
    assert.match(draft, /Wednesday/i); assert.ok(draft.length < 4000);
    const continuity = await write(CONTINUITY_INSTRUCTIONS, JSON.stringify({ previous: [], messages: [{ id: 1, role: "user", content: "The fictional Cedar launch is Wednesday." }, { id: 2, role: "user", content: "Correction: it is Thursday now. No specific time is agreed." }] }), "continuity");
    const items = continuityItems(JSON.parse(continuity).items, 2);
    assert.ok(items.some((item) => /Thursday/i.test(item.text) && item.refs.includes(2)));
    const preparation = preparationInput({ parts: [{ key: "events", title: "Calendar", lines: ["Fictional Cedar review, Thursday at noon. Bring the launch checklist."] }] }, new Date("2026-10-22T00:00:00Z"));
    const prepared = preparedBriefOutput(await write(PREPARATION_INSTRUCTIONS, preparation.task, "preparation"), preparation.sources, profile);
    assert.ok(prepared.lines.length > 0);
    const analysis = await write(SOURCE_ANALYSIS_INSTRUCTIONS, JSON.stringify({ note: 1, title: "Fictional Cedar", sourceState: "current", offset: 0, end: 39, totalCharacters: 39, text: "Launch Thursday. Venue is not confirmed." }), "analysis");
    assert.match(analysis, /Thursday/i); assert.ok(Buffer.byteLength(analysis) <= 3500);
  });
}
