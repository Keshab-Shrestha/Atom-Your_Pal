import type { HelperStore, Job } from "@atom/helpers";

type SummaryStore = Pick<HelperStore, "get"> & Partial<Pick<HelperStore, "taskEvidence" | "toolCalls">>;
export interface WakeTaskUpdate { job?: number; stopped: boolean }

/** Replace partial stopped-worker prose with current, chat-owned host observations. No actions or new model call. */
export function stoppedTaskSummary(store: SummaryStore, chat: string, updates: readonly WakeTaskUpdate[]): string | undefined {
  const jobs: Job[] = [];
  const seen = new Set<number>();
  let unknown = false;
  for (const update of updates) {
    const job = update.job === undefined ? undefined : store.get(update.job);
    if (!job || job.chatId !== chat) { unknown = true; continue; }
    if (!seen.has(job.id)) { seen.add(job.id); jobs.push(job); }
  }
  if (!jobs.some((job) => job.state === "stopped") && !updates.some((update) => update.stopped)) return;
  const lines: string[] = [];
  for (const job of jobs) {
    if (job.state !== "stopped") {
      // A combined wake can include another worker's completion. Retain its result link without repeating
      // an inseparable model paragraph that may contain the stopped worker's incorrect count.
      lines.push(`Task #${job.id}: ${job.state === "done" ? "report saved" : job.state === "failed" ? "needs review" : "outcome not yet confirmed"}. Open its task history for details.`);
      continue;
    }
    lines.push(`Task #${job.id} stopped.`);
    try {
      const attempt = store.taskEvidence?.(job.id);
      const start = Date.parse(attempt?.startedAt ?? ""), end = Date.parse(attempt?.endedAt ?? "");
      if (attempt?.state !== "stopped" || !Number.isFinite(start) || !Number.isFinite(end) || end < start || !store.toolCalls) throw new Error();
      const counts = new Map<string, number>();
      for (const call of store.toolCalls(job.id)) {
        const at = Date.parse(call.at);
        // A successful record must end within this attempt and before Stop. Pending/failed calls and
        // older attempts cannot become completed actions. The API returns bounded recent history.
        if (call.state !== "ok" || !Number.isFinite(at) || at < start || !Number.isFinite(call.ms) || call.ms! < 0 || at + call.ms! > end) continue;
        const name = ["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"].includes(call.tool) ? call.tool : "other tool";
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      lines.push(counts.size
        ? `Recent host history records successful calls before Stop: ${[...counts].map(([name, count]) => `${name} × ${count}`).join(", ")}.`
        : "No successful calls are shown in the available history for this attempt; that does not prove nothing happened.");
    } catch {
      lines.push("Recorded activity counts are unavailable. Review the task history; the worker's partial note is not a confirmed count.");
    }
  }
  if (unknown) lines.push("Another background update could not be matched to this chat's task records. Review task history for its outcome.");
  lines.push("Files may already have changed. Review the task and existing changes before choosing Retry. Nothing was restarted by this notice.");
  return lines.join("\n\n");
}
