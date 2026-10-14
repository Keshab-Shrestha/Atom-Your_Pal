// Task 3.9, ADR-094: what runs by itself on the clock. Each tick, routines that came due make their tasks, then workers
// whose wake-up time has come wake (and may take a team task). Deterministic: no model. Logs ids only.

import type { HelperStore, Routine } from "@atom/helpers";
import type { LogFields, Logger } from "@atom/shared";

/** How often the clock looks. */
export const SCHEDULER_TICK_MS = 30_000;

/**
 * One tick. A failure in routines does not stop the wake-ups (each is logged with `describe`, which carries no task
 * text).
 * ADR-110 (N3): `nativeStart` (the native engine) runs a due routine as a main-agent turn, and no worker wakes up.
 */
export function scheduleTick(
  store: Pick<HelperStore, "runRoutines" | "runWakeUps">,
  log: Pick<Logger, "info" | "warn">,
  describe: (error: unknown) => LogFields,
  nativeStart?: (routine: Routine) => boolean,
): void {
  try {
    store.runRoutines(nativeStart);
  } catch (error) {
    log.warn("routines.failed", describe(error));
  }
  if (nativeStart) return; // Keshab, 2026-10-14: no wake-ups or team tasks on the native engine
  try {
    for (const woken of store.runWakeUps()) log.info("wakeup.woke", { ...woken });
  } catch (error) {
    log.warn("wakeups.failed", describe(error));
  }
}
