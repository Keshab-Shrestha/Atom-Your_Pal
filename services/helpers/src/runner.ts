import type { HelperId } from "./jobs.ts";
import type { HelperStore, Job, ReportInput } from "./store.ts";

// ADR-081/082, Task 3.2: runs queued jobs in the background. Pure orchestration: the work itself is `run`.
// At most MAX_RUNNING jobs at once and one per helper; queued jobs start oldest first. A running job never blocks
// anything: nothing waits for it, and a stop or delete in the store ends it at once (its late result is dropped).

export const MAX_RUNNING = 3;
export const JOB_TIME_LIMIT_MS = 15 * 60_000;
/** After the time limit aborts a run, how long it may take to hand back what it has. */
const LATE_GRACE_MS = 1000;

export interface RunOutcome {
  report: ReportInput;
  /** Ended at a limit with what it had. */
  partial?: boolean;
  /** Pages read, for the log. */
  pages?: number;
}

export interface RunContext {
  /** Aborted on stop, delete, the time limit and shutdown. */
  signal: AbortSignal;
  /** Progress in plain words; ignored once the job is no longer running. */
  onStep(text: string): void;
}

/** The work for one job. Throws an Error with a plain message for the user when the job fails. */
export type JobRun = (job: Job, context: RunContext) => Promise<RunOutcome>;

/** For the log: ids, states, timings and counts only. Never the task, report or addresses. */
export type RunEvent =
  | { phase: "start"; helper: HelperId; job: number }
  | { phase: "end"; helper: HelperId; job: number; state: "done" | "failed" | "stopped"; ms: number; pages?: number; partial: boolean };

export interface JobRunnerOptions {
  store: Pick<HelperStore, "queued" | "get" | "start" | "step" | "finish" | "fail" | "onChange">;
  run: JobRun;
  maxRunning?: number;
  timeLimitMs?: number;
  graceMs?: number;
  onRun?: (event: RunEvent) => void;
}

export interface JobRunner {
  /** Shutdown: aborts every run and writes nothing (the store marks them failed at the next start). */
  close(): void;
}

interface Running {
  helper: HelperId;
  controller: AbortController;
  cancel(): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)) || "The job failed.";
const minutes = (ms: number) => `${Math.round(ms / 60_000)} minute${Math.round(ms / 60_000) === 1 ? "" : "s"}`;

export function startJobRunner(options: JobRunnerOptions): JobRunner {
  const { store, run, maxRunning = MAX_RUNNING, timeLimitMs = JOB_TIME_LIMIT_MS, graceMs = LATE_GRACE_MS, onRun } = options;
  const running = new Map<number, Running>();
  let closed = false;
  let scheduled = false;

  /** Starts what can start, after the current change has finished (store listeners are called mid-change). */
  function schedule() {
    if (scheduled || closed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (closed) return;
      for (const job of store.queued()) {
        if (running.size >= maxRunning) return;
        if ([...running.values()].some((r) => r.helper === job.helper)) continue;
        void drive(job);
      }
    });
  }

  async function drive(job: Job) {
    let cancel = () => {};
    const cancelled = new Promise<"cancelled">((resolve) => (cancel = () => resolve("cancelled")));
    const entry: Running = { helper: job.helper, controller: new AbortController(), cancel };
    running.set(job.id, entry);
    try {
      store.start(job.id);
    } catch {
      running.delete(job.id); // stopped or deleted in the same moment: nothing to run
      return schedule();
    }
    const started = Date.now();
    onRun?.({ phase: "start", helper: job.helper, job: job.id });

    const settled = Promise.resolve()
      .then(() => run(job, { signal: entry.controller.signal, onStep: (text) => void store.step(job.id, text) }))
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = (ms: number) => new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), ms)));
    let outcome = await Promise.race([settled, cancelled, late(timeLimitMs)]);
    const timedOut = outcome === "late";
    if (timedOut) {
      entry.controller.abort();
      clearTimeout(timer);
      outcome = await Promise.race([settled, cancelled, late(graceMs)]);
    }
    clearTimeout(timer);
    entry.controller.abort(); // the run's work stops, however the job ended
    running.delete(job.id);
    schedule();

    const end = (state: "done" | "failed" | "stopped", partial = false, pages?: number) =>
      onRun?.({ phase: "end", helper: job.helper, job: job.id, state, ms: Date.now() - started, ...(pages !== undefined ? { pages } : {}), partial });
    if (closed) return;
    // Stopped or deleted (here or in the moment before): the store already says so, and the result is dropped.
    if (outcome === "cancelled" || store.get(job.id)?.state !== "running") return end("stopped");
    const timeMessage = `Took longer than ${minutes(timeLimitMs)}`;
    try {
      if (typeof outcome === "object" && "value" in outcome) {
        const partial = Boolean(outcome.value.partial) || timedOut;
        store.finish(job.id, outcome.value.report, partial);
        end("done", partial, outcome.value.pages);
      } else {
        store.fail(job.id, timedOut ? timeMessage : message(typeof outcome === "object" ? outcome.error : undefined));
        end("failed");
      }
    } catch (error) {
      // A report the store refuses still ends the job.
      store.fail(job.id, message(error));
      end("failed");
    }
  }

  const unsubscribe = store.onChange((change) => {
    if (change.action === "job" && change.state === "queued") schedule();
    else if ((change.action === "job" && change.state === "stopped") || change.action === "deleted") {
      const entry = running.get(change.job);
      if (!entry) return;
      entry.controller.abort();
      entry.cancel();
    }
  });
  schedule(); // jobs queued before the runner started (a restart)

  return {
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const entry of running.values()) {
        entry.controller.abort();
        entry.cancel();
      }
    },
  };
}
