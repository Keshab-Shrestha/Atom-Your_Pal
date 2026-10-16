// The schedules (routines) part of the helper store: add, change, pause, start, remove, and the clock's catch-up (split out of store.ts, 2026-10-16).

import { anchorFor, checkSchedule, isDue } from "./routines.ts";
import { HelperError } from "./jobs.ts";
import type { StoreContext } from "./store-context.ts";
import type { HelperStore } from "./store-types.ts";

export function routineMethods(ctx: StoreContext): Pick<HelperStore, "pauseRoutine" | "addRoutine" | "updateRoutine" | "startRoutine" | "removeRoutine" | "runRoutines"> {
  const { now, emit, routines, availableHelper, cleanTask } = ctx;
  return {
    pauseRoutine(id, paused) {
      const routine = routines.get(id);
      if (!routine) throw new HelperError("There is no such routine.");
      if (routine.paused === paused) return;
      routines.pause(id, paused, now());
      emit({ action: "routine", helper: routine.helper, routine: id, outcome: paused ? "paused" : "resumed" });
    },

    addRoutine(helper, raw, schedule, startAt, notifyTelegram, webhook) {
      const known = availableHelper(helper);
      const id = routines.add(known.id, cleanTask(raw), schedule, anchorFor(schedule, startAt, now()));
      if (notifyTelegram) routines.notify(id, true);
      if (webhook) routines.webhook(id, true);
      emit({ action: "routine", helper: known.id, routine: id, outcome: "added" });
      return routines.get(id)!;
    },

    updateRoutine(id, helper, raw, schedule, startAt, notifyTelegram, webhook) {
      const routine = routines.get(id);
      if (!routine) throw new HelperError("There is no such routine.");
      const known = availableHelper(helper);
      const at = now();
      // The hourly anchor moves only when the schedule or its start changes; the text alone keeps the times.
      const same = JSON.stringify(routine.schedule) === JSON.stringify(checkSchedule(schedule)) && !startAt;
      routines.update(id, known.id, cleanTask(raw), schedule, same ? routine.createdAt : anchorFor(schedule, startAt, at), at);
      if (notifyTelegram !== undefined) routines.notify(id, notifyTelegram);
      if (webhook !== undefined) routines.webhook(id, webhook);
      emit({ action: "routine", helper: known.id, routine: id, outcome: "changed" });
      return routines.get(id)!;
    },

    startRoutine(id, start) {
      const routine = routines.get(id);
      if (!routine) throw new HelperError("There is no such routine.");
      if (!start(routine)) throw new HelperError("Its last run has not ended.");
      routines.markNative(id, now(), false);
      emit({ action: "routine", helper: routine.helper, routine: id, outcome: "made" });
    },

    removeRoutine(id) {
      const routine = routines.get(id);
      if (!routine || !routines.remove(id)) return false;
      emit({ action: "routine", helper: routine.helper, routine: id, outcome: "removed" });
      return true;
    },

    runRoutines(start) {
      const at = now();
      const made: number[] = [];
      const skipped: number[] = [];
      for (const r of routines.list()) {
        if (r.paused || !isDue(r, at)) continue;
        let started = false;
        try {
          started = start(r);
        } catch {
          // the start failed: skipped this time
        }
        routines.markNative(r.id, at, !started);
        (started ? made : skipped).push(r.id);
        emit({ action: "routine", helper: r.helper, routine: r.id, outcome: started ? "made" : "skipped" });
      }
      return { made, skipped };
    },
  };
}
