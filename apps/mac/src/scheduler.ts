// Task 3.9: what runs by itself on the clock. Each tick, routines that came due start as main-agent turns (ADR-110 N3).
// Deterministic: no model. Logs ids only.

import type { HelperStore, Routine } from "@atom/helpers";
import type { LogFields, Logger } from "@atom/shared";

/** How often the clock looks. */
export const SCHEDULER_TICK_MS = 30_000;

/** One tick. A failure is logged with `describe`, which carries no task text. `start` runs a due routine; false: it is still going. */
export function scheduleTick(
  store: Pick<HelperStore, "runRoutines">,
  log: Pick<Logger, "info" | "warn">,
  describe: (error: unknown) => LogFields,
  start: (routine: Routine) => boolean,
): void {
  try {
    store.runRoutines(start);
  } catch (error) {
    log.warn("routines.failed", describe(error));
  }
}
