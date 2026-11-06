import type { HelperChange, HelperStore } from "@ark/helpers";

/**
 * ADR-273: the stuck dot. A running native Board job (one a chat's agent call made) with no tool call and no progress for
 * QUIET_AFTER_MS is marked quiet once and logged `job.quiet`. Its next step, tool call or state change clears the mark.
 * A move of a job is also a move of each job above it (its parent, that job's parent...): a manager that waits on a moving
 * worker is not quiet.
 * The mark lives in memory only: after a restart each running job starts a fresh count. Nothing goes to the model.
 */
export const QUIET_AFTER_MS = 8 * 60_000;
const SWEEP_MS = 60_000;

export interface QuietWatch {
  /** When a quiet job last moved; undefined when it is not quiet. */
  since(job: number): Date | undefined;
  /** Checks every running native job now (the timer calls it each minute). */
  sweep(): void;
  /** Called when a job becomes quiet or moves again. */
  onChange(listener: () => void): () => void;
  stop(): void;
}

const MOVES = new Set<HelperChange["action"]>(["step", "toolCall", "job"]);

export function quietWatch(
  store: Pick<HelperStore, "list" | "onChange" | "get">,
  options: { now?: () => number; log?: (event: string, fields: Record<string, unknown>) => void; sweepMs?: number } = {},
): QuietWatch {
  const now = options.now ?? Date.now;
  const lastMove = new Map<number, number>();
  const quiet = new Map<number, number>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };

  const unsubscribe = store.onChange((change) => {
    if (!MOVES.has(change.action) || !("job" in change)) return;
    let cleared = false;
    // ponytail: walks up with get(); ADR-272 caps the depth at 4, the seen set only stops a bad parent loop.
    for (let id: number | undefined = change.job, seen = new Set<number>(); id !== undefined && !seen.has(id); id = store.get(id)?.parentId) {
      seen.add(id);
      lastMove.set(id, now());
      if (quiet.delete(id)) cleared = true;
    }
    if (cleared) changed();
  });

  const sweep = () => {
    // ponytail: list() holds each helper's newest jobs; a running job is always among them.
    const running = store.list().flatMap((h) => h.jobs).filter((j) => j.state === "running" && j.chatId);
    const ids = new Set(running.map((j) => j.id));
    for (const id of [...lastMove.keys()]) if (!ids.has(id)) { lastMove.delete(id); quiet.delete(id); }
    let any = false;
    for (const job of running) {
      const last = lastMove.get(job.id);
      if (last === undefined) { lastMove.set(job.id, now()); continue; }
      if (quiet.has(job.id) || now() - last < QUIET_AFTER_MS) continue;
      quiet.set(job.id, last);
      any = true;
      options.log?.("job.quiet", { job: job.id, ...(job.parentId !== undefined ? { parent: job.parentId } : {}) });
    }
    if (any) changed();
  };

  const timer = options.sweepMs === 0 ? undefined : setInterval(sweep, options.sweepMs ?? SWEEP_MS);
  timer?.unref?.();

  return {
    since: (job) => { const at = quiet.get(job); return at === undefined ? undefined : new Date(at); },
    sweep,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    stop() { if (timer) clearInterval(timer); unsubscribe(); },
  };
}
