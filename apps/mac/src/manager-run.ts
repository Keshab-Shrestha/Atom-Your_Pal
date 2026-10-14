// ADR-095: a "plan" Manager's runs. Each has no tools and answers in one structured shape. The first run splits the part
// ATOM gave it across its Agents (at most six tasks); when those have ended, the next run reviews their reports and
// either asks one of them for its one revision (a note that wakes that task) or passes a summary up to ATOM. After the
// revision it passes up whatever comes back. The store checks every task and the one-revision limit again.

import { runManagerReview, runManagerSplit, type ClaudeSdk, type PlanUsage, type TokenUsage } from "@atom/llm-gateway";
import { managerInstructions, managerReviewBrief, managerSplitBrief, type HelperStore, type Job, type ReportInput, type Source } from "@atom/helpers";

export interface ManagerRun {
  store: HelperStore;
  /** One of a Manager's tasks. */
  job: Job;
  run: {
    claudePath: string;
    model: string;
    signal: AbortSignal;
    onStep?: (text: string) => void;
    onUsage?: (usage: PlanUsage) => void;
    sdk?: ClaudeSdk;
  };
  /** What the run cost and the tokens it used (for the Dashboard). */
  count(costUsd: number | undefined, tokens: TokenUsage | undefined): void;
  /** For the log: ids, counts and outcomes only. */
  onEvent?(event: { manager: string; job: number; outcome: "split" | "revised" | "passed"; tasks: number }): void;
}

const MAX_SOURCES = 20;

export async function runManager({ store, job, run, count, onEvent }: ManagerRun): Promise<{ report: ReportInput }> {
  const manager = store.managers().find((m) => m.id === job.helper);
  if (!manager) throw new Error("That manager is gone.");
  const instructions = managerInstructions(manager.soul);
  const work = store.managerWork(job.id);
  if (!work.tasks.length) {
    const team = store.list().filter((w) => w.manager === manager.id && w.available && w.role !== "improver");
    if (!team.length) throw new Error(`${manager.name} has no Agents to hand the work to.`);
    run.onStep?.("Splitting the work");
    const { split, costUsd, tokens } = await runManagerSplit({ ...run, instructions, task: managerSplitBrief(job.task, job.goal, team) });
    count(costUsd, tokens);
    const byName = (name: string) => team.find((w) => w.name.toLowerCase() === name.trim().toLowerCase() || w.id === name.trim().toLowerCase());
    const made = store.managerSplit(
      job.id,
      split.tasks.map((t, i) => {
        const agent = byName(t.worker);
        if (!agent) throw new Error(`${manager.name} named "${t.worker.slice(0, 40)}" for task ${i + 1}, who is not one of its Agents.`);
        return { helper: agent.id, task: t.task, ...(t.after.length ? { after: t.after } : {}) };
      }),
    );
    onEvent?.({ manager: manager.id, job: job.id, outcome: "split", tasks: made.length });
    const names = [...new Set(made.map((t) => store.soul(t.helper).name))];
    return report(`${manager.name} split the work`, `${made.length} task${made.length === 1 ? "" : "s"} for ${names.join(", ")}.`, made.map((t, i) => `${i + 1}. ${store.soul(t.helper).name}: ${t.task}`).join("\n"));
  }
  const done = work.tasks.filter((t) => t.state === "done");
  if (!done.length) throw new Error(`None of ${manager.name}'s tasks finished.`);
  run.onStep?.("Reviewing the reports");
  const { review, costUsd, tokens } = await runManagerReview({ ...run, instructions, task: managerReviewBrief(job.task, work.tasks, work.revised) });
  count(costUsd, tokens);
  const target = review.revise && !work.revised ? work.tasks[review.task - 1] : undefined;
  if (target?.state === "done" && review.note.trim()) {
    store.managerRevise(job.id, target.id, review.note);
    onEvent?.({ manager: manager.id, job: job.id, outcome: "revised", tasks: work.tasks.length });
    return report(`${manager.name} asked ${target.worker} to revise`, review.note.trim().slice(0, 160));
  }
  onEvent?.({ manager: manager.id, job: job.id, outcome: "passed", tasks: work.tasks.length });
  return { report: { title: review.title, summary: review.summary, body: review.body, sources: sourcesOf(store, done.map((t) => t.id)) } };
}

const report = (title: string, summary: string, body = summary): { report: ReportInput } => ({ report: { title: title.slice(0, 80), summary, body, sources: [] } });

/** Every done task's sources, first seen first, without repeats. */
function sourcesOf(store: HelperStore, ids: readonly number[]): Source[] {
  const seen = new Map<string, Source>();
  for (const s of ids.flatMap((id) => store.report(id)?.sources ?? [])) if (!seen.has(s.url)) seen.set(s.url, s);
  return [...seen.values()].slice(0, MAX_SOURCES);
}
