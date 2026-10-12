// Task 3.13, ADR-094: Tinker's runs. Each has no tools and answers in one structured shape: a review proposes one soul
// change, a draft turns a task rated good into a skill, an edit improves one of ATOM's skills after a task that used it
// went badly. Whatever Tinker writes waits for Keshab's OK in the store; nothing here changes a soul or a skill.

import { runReview, runSkillDraft, runSkillEdit, type ClaudeSdk, type PlanUsage, type TokenUsage } from "@zeno/llm-gateway";
import { reviewBrief, skillDraftBrief, skillEditBrief, type HelperStore, type Job, type ReportInput } from "@zeno/helpers";

export interface TinkerRun {
  store: HelperStore;
  /** One of Tinker's tasks. */
  job: Job;
  run: {
    claudePath: string;
    model: string;
    instructions: string;
    signal: AbortSignal;
    onStep?: (text: string) => void;
    onUsage?: (usage: PlanUsage) => void;
    sdk?: ClaudeSdk;
  };
  /** What the run cost and the tokens it used (for budgets and the Dashboard). */
  count(costUsd: number | undefined, tokens: TokenUsage | undefined): void;
  /** ADR-098 item 8: runs the target's test cases on a new soul proposal or skill edit (inside this task). */
  test?(kind: "soul" | "skill", id: number): Promise<unknown>;
}

const report = (title: string, summary: string, body = summary): { report: ReportInput } => ({ report: { title: title.slice(0, 80), summary, body, sources: [] } });

export async function runTinker({ store, job, run, count, test }: TinkerRun): Promise<{ report: ReportInput }> {
  if (job.reviewKind === "skill") {
    const target = store.skillDraftTarget(job.id);
    if (!target) throw new Error("The task to make a skill from is gone.");
    const { draft, costUsd, tokens } = await runSkillDraft({ ...run, task: skillDraftBrief(target) });
    count(costUsd, tokens);
    store.addSkillDraft(job.id, draft);
    return report(`A skill draft: ${draft.name}`, draft.description, `${draft.description}\n\n${draft.body}`);
  }
  if (job.reviewKind === "edit") {
    const target = store.skillEditTarget(job.id);
    if (!target) throw new Error("The skill to improve is gone, or is not one of ATOM's own.");
    const { edit, costUsd, tokens } = await runSkillEdit({ ...run, task: skillEditBrief(target) });
    count(costUsd, tokens);
    if (!edit.change || !edit.body.trim() || edit.body.trim() === target.body.trim()) return report(`No change to the ${target.skill} skill`, edit.reason);
    const saved = store.addSkillEdit(job.id, edit);
    await test?.("skill", saved.id);
    return report(`An edit to the ${target.skill} skill`, edit.reason, edit.body);
  }
  const target = store.reviewTarget(job.id);
  if (!target) throw new Error("The task to review is gone.");
  const { review, costUsd, tokens } = await runReview({ ...run, task: reviewBrief(target) });
  count(costUsd, tokens);
  if (!review.change || !review.text.trim()) return report(`No change for ${target.worker}`, review.reason);
  const proposal = store.addProposal(job.id, review);
  await test?.("soul", proposal.id);
  return report(`A change for ${target.worker}'s ${review.field}`, review.reason, review.text);
}
