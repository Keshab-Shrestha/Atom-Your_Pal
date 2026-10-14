import type { HelperStore, Job, ReportInput } from "@atom/helpers";

// ADR-110 N5: runs Tinker's queued tasks (a soul review, a skill draft, a skill edit) in the background. Everything else
// runs as a native sub-agent of a chat; Tinker's tasks have no chat, so they keep this small runner. Every Tinker task
// starts at once, oldest first. A stop or delete in the store ends it, and its late result is dropped.

/** A Tinker task makes one no-tool run; it is stopped after this long. */
export const TINKER_TIME_LIMIT_MS = 15 * 60_000;

/** Tinker's helper id: the store queues its tasks under it. */
const TINKER = "tinker";

export interface TinkerRunnerOptions {
  store: Pick<HelperStore, "queued" | "get" | "start" | "step" | "finish" | "fail" | "onChange">;
  /** The work for one task. Throws an Error with a plain message for the user when the task fails. */
  run(job: Job, context: { signal: AbortSignal; onStep(text: string): void }): Promise<{ report: ReportInput }>;
  timeLimitMs?: number;
  /** For the log: ids, states and timings only. Never the task or the report. */
  onRun?(event: { phase: "start" | "end"; job: number; state?: "done" | "failed" | "stopped"; ms?: number }): void;
}

export interface TinkerRunner {
  /** Looks again for tasks that may start. */
  poke(): void;
  /** Shutdown: aborts every run and writes nothing (the store marks them failed at the next start). */
  close(): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)) || "The task failed.";

export function startTinkerRunner(options: TinkerRunnerOptions): TinkerRunner {
  const { store, run, timeLimitMs = TINKER_TIME_LIMIT_MS, onRun } = options;
  const running = new Map<number, AbortController>();
  let closed = false;
  let scheduled = false;

  /** Starts what can start, after the current change has finished (store listeners are called mid-change). */
  function schedule() {
    if (scheduled || closed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (closed) return;
      for (const job of store.queued()) if (job.helper === TINKER && !running.has(job.id)) void drive(job);
    });
  }

  async function drive(job: Job) {
    const controller = new AbortController();
    running.set(job.id, controller);
    try {
      store.start(job.id);
    } catch {
      running.delete(job.id); // stopped or deleted in the same moment: nothing to run
      return;
    }
    const started = Date.now();
    onRun?.({ phase: "start", job: job.id });
    const timer = setTimeout(() => controller.abort(), timeLimitMs);
    let outcome: { report: ReportInput } | { error: unknown };
    try {
      outcome = await Promise.race([
        run(job, { signal: controller.signal, onStep: (text) => void store.step(job.id, text) }),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error(`Took longer than ${Math.round(timeLimitMs / 60_000)} minutes`)), { once: true })),
      ]);
    } catch (error) {
      outcome = { error };
    }
    clearTimeout(timer);
    controller.abort(); // the run's work stops, however the task ended
    running.delete(job.id);
    const end = (state: "done" | "failed" | "stopped") => onRun?.({ phase: "end", job: job.id, state, ms: Date.now() - started });
    // Stopped or deleted: the store already says so, and the result is dropped.
    if (closed || store.get(job.id)?.state !== "running") return end("stopped");
    try {
      if ("report" in outcome) {
        store.finish(job.id, outcome.report, false);
        end("done");
      } else {
        store.fail(job.id, message(outcome.error));
        end("failed");
      }
    } catch (error) {
      // A report the store refuses still ends the task.
      store.fail(job.id, message(error));
      end("failed");
    }
  }

  const unsubscribe = store.onChange((change) => {
    // A new task, or a stop or delete of a running one.
    if (change.action === "job" && change.state === "queued") schedule();
    if ((change.action === "job" && change.state === "stopped") || change.action === "deleted") running.get(change.job)?.abort();
  });
  schedule(); // tasks queued before the runner started (a restart)

  return {
    poke: schedule,
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const controller of running.values()) controller.abort();
    },
  };
}
