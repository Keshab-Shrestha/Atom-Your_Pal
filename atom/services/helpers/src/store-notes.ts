// Notes on a task and goals for the helper store: comments, labels, token usage entries and a goal with its tasks (split out of store.ts, 2026-10-16).

import { HelperError } from "./jobs.ts";
import { type StoreContext } from "./store-context.ts";
import type { JobRow } from "./store-schema.ts";
import type { GoalReport, HelperStore } from "./store-types.ts";

export function noteMethods(ctx: StoreContext): Pick<HelperStore, "addComment" | "addLabel" | "removeLabel" | "addUsage" | "goal"> {
  const { now, emit, mustGet, transaction, insertComment, log, wake, finder, tokens, goalRow, goalTasks, toJob } = ctx;
  return {
    addComment(id, raw, delivery) {
      const job = mustGet(id);
      const text = raw.trim();
      if (!text) throw new HelperError("The note is empty.");
      transaction(() => {
        insertComment.run(id, text, now().toISOString(), delivery ?? null);
        log(id, "commented");
      });
      emit({ action: "comment", helper: job.helper, job: id });
      if (delivery !== "live") wake(job); // the run took a "live" message: nothing more to do
    },

    addLabel(id, raw) {
      const job = mustGet(id);
      const label = finder.add(id, raw);
      emit({ action: "label", helper: job.helper, job: id });
      return label;
    },

    removeLabel(id, label) {
      const job = mustGet(id);
      if (finder.remove(id, label)) emit({ action: "label", helper: job.helper, job: id });
    },

    addUsage(entry) {
      const result = tokens.add(entry);
      emit({ action: "usage" });
      return result;
    },

    goal(id) {
      const row = goalRow.get(id) as { id: number; text: string; created_at: string; ended_at: string | null; report: string | null; source: string | null; project_id: string | null; chat_posted_at: string | null } | undefined;
      if (!row) return undefined;
      return {
        id: row.id,
        text: row.text,
        createdAt: new Date(row.created_at),
        ...(row.ended_at ? { endedAt: new Date(row.ended_at) } : {}),
        tasks: (goalTasks.all(id) as unknown as JobRow[]).map(toJob),
        ...(row.report ? { report: JSON.parse(row.report) as GoalReport } : {}),
        ...(row.source ? { source: row.source } : {}),
        ...(row.project_id ? { projectId: row.project_id } : {}),
        ...(row.chat_posted_at ? { chatPostedAt: new Date(row.chat_posted_at) } : {}),
      };
    },
  };
}
