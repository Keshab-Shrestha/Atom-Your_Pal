// ADR-098 item 8: a test run of a soul proposal or a skill edit. Each of the newest test cases is answered twice as a
// dry run (no tools, effort low): once with the old text, once with the new; then a judge compares both answers with
// the saved report. Results go to the store; nothing here accepts or rejects the change.

import { runTestAnswer, runTestJudge, type ClaudeSdk, type PlanUsage, type TokenUsage } from "@atom/llm-gateway";
import { testAnswerBrief, testJudgeBrief, type HelperStore, type TestKind } from "@atom/helpers";

/** Claude's own rate limit stopped the rest (ADR-110 N4: ATOM sets no limit of its own). */
export const NOT_RUN_PLAN_LIMIT = "Not run: plan limit";

export interface TestRun {
  store: HelperStore;
  kind: TestKind;
  /** The soul proposal's or skill edit's id. */
  id: number;
  run: { claudePath: string; model: string; signal: AbortSignal; onUsage?: (usage: PlanUsage) => void; sdk?: ClaudeSdk };
  /** What each run cost and its tokens (for the Dashboard). */
  count(costUsd: number | undefined, tokens: TokenUsage | undefined): void;
  /** Logs ids, states and counts only. */
  onEvent?(event: Record<string, string | number>): void;
}

const JUDGE = "You are ATOM's test judge.";

/** Runs the test cases; returns the counts (none when the target has no test cases). */
export async function runTestCases({ store, kind, id, run, count, onEvent }: TestRun) {
  const inputs = store.testInputs(kind, id);
  const counts = { better: 0, same: 0, worse: 0, notRun: 0, failed: 0 };
  if (!inputs.cases.length) return counts;
  store.startTestRun(kind, id, inputs.cases);
  let stop: string | undefined;
  for (const c of inputs.cases) {
    if (stop) {
      store.finishTestCase(kind, id, c, { state: "skipped", reason: stop });
      counts.notRun += 1;
      continue;
    }
    try {
      const answer = async (instructions: string) => {
        const out = await runTestAnswer({ ...run, instructions, task: testAnswerBrief(c.task) });
        count(out.costUsd, out.tokens);
        return out.answer;
      };
      const oldAnswer = await answer(inputs.oldInstructions);
      const newAnswer = await answer(inputs.newInstructions);
      const { verdict, costUsd, tokens } = await runTestJudge({ ...run, instructions: JUDGE, task: testJudgeBrief(c.task, c.report, oldAnswer, newAnswer) });
      count(costUsd, tokens);
      store.finishTestCase(kind, id, c, { state: "done", better: verdict.better, reason: verdict.reason, oldAnswer, newAnswer });
      counts[verdict.better === "new" ? "better" : verdict.better === "old" ? "worse" : "same"] += 1;
    } catch (error) {
      const kindOf = error instanceof Error && "kind" in error ? (error as { kind?: string }).kind : undefined;
      // Claude's rate limit stops the rest; any other failure is this case's only.
      if (kindOf === "rate_limit") stop = NOT_RUN_PLAN_LIMIT;
      if (kindOf === "cancelled") stop = "Not run: stopped";
      store.finishTestCase(kind, id, c, { state: stop ? "skipped" : "failed", reason: stop ?? (error instanceof Error ? error.message : String(error)) });
      counts[stop ? "notRun" : "failed"] += 1;
    }
  }
  onEvent?.({ kind, id, cases: inputs.cases.length, ...counts });
  return counts;
}
