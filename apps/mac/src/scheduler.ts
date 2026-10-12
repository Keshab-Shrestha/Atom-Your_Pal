// Task 3.9, ADR-094: what runs by itself on the clock. Each tick, routines that came due make their tasks, then workers
// whose wake-up time has come wake (and may take a team task). Deterministic: no model. Logs ids only.

import type { HelperStore } from "@atom/helpers";
import type { LogFields, Logger } from "@atom/shared";

/** How often the clock looks. */
export const SCHEDULER_TICK_MS = 30_000;

/**
 * One tick. A failure in routines does not stop the wake-ups (each is logged with `describe`, which carries no task
 * text). `planUsed` is the plan's five-hour use in percent, when known.
 */
export function scheduleTick(
  store: Pick<HelperStore, "runRoutines" | "runWakeUps">,
  planUsed: number | undefined,
  log: Pick<Logger, "info" | "warn">,
  describe: (error: unknown) => LogFields,
): void {
  try {
    store.runRoutines();
  } catch (error) {
    log.warn("routines.failed", describe(error));
  }
  try {
    for (const woken of store.runWakeUps(planUsed)) log.info("wakeup.woke", { ...woken });
  } catch (error) {
    log.warn("wakeups.failed", describe(error));
  }
}
