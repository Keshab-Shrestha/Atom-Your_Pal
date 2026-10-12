import { HelperError, MAX_COMMENT_CHARS, type HelperStore } from "@zeno/helpers";
import type { Logger } from "@zeno/shared";
import type { LiveRun, RunSteering } from "@zeno/llm-gateway";

// ADR-098 item 3: Keshab steers or interrupts a running task. The ATOM window and Telegram call the same two functions.
// Logs ids and states only, never the message.

export interface TaskSteering {
  /** For a run Keshab may steer: its handle while it runs. */
  track(job: number): RunSteering;
  /**
   * Keshab's message to a task. A running task that can take it gets it at its next step ("live"); otherwise it is kept
   * as a note that wakes the task ("queued"): a running task runs once more after this run, an interrupted or ended
   * one runs again. Throws HelperError for an unknown task or an empty or long message.
   */
  steer(id: number, text: string): "live" | "queued";
  /** Stops a running task's current step; the task then waits for Keshab's message. Throws HelperError when it cannot. */
  interrupt(id: number): Promise<void>;
}

export function taskSteering(store: Pick<HelperStore, "get" | "addComment" | "steerUnread">, log: Logger): TaskSteering {
  const live = new Map<number, LiveRun>();
  return {
    track: (job) => ({
      attach: (run) => void live.set(job, run),
      detach(unread) {
        live.delete(job);
        if (unread > 0) store.steerUnread(job, unread);
      },
    }),
    steer(id, raw) {
      const text = raw.trim();
      if (!text) throw new HelperError("The message is empty.");
      if (text.length > MAX_COMMENT_CHARS) throw new HelperError(`The message is too long (${text.length} characters, limit ${MAX_COMMENT_CHARS}).`);
      const job = store.get(id);
      if (!job) throw new HelperError("That task is gone.");
      const running = job.state === "running";
      const taken = running && live.get(id)?.steer(text) === true;
      store.addComment(id, text, taken ? "live" : running ? "after" : undefined);
      log.info("job.steer", { helper: job.helper, job: id, state: job.state, live: taken });
      return taken ? "live" : "queued";
    },
    async interrupt(id) {
      const job = store.get(id);
      if (!job) throw new HelperError("That task is gone.");
      if (job.state !== "running") throw new HelperError("Only a running task can be interrupted.");
      const run = live.get(id);
      const ok = run ? await run.interrupt() : false;
      log.info("job.interrupt", { helper: job.helper, job: id, ok });
      if (!ok) throw new HelperError("This run cannot be interrupted now. Stop it instead.");
    },
  };
}
