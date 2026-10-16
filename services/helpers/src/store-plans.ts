// The work plans part of the helper store (ADR-111): a plan of portions for a chat, and the link from a portion to the task that does it (split out of store.ts, 2026-10-16).

import { HelperError } from "./jobs.ts";
import type { StoreContext } from "./store-context.ts";
import type { HelperStore } from "./store-types.ts";

export function planMethods(ctx: StoreContext): Pick<HelperStore, "addPlan" | "plan" | "latestPlan" | "plans" | "linkPlanJob"> {
  const { emit, get, workPlans, planView } = ctx;
  const planOf = (id: number) => {
    const stored = workPlans.get(id);
    return stored && planView(stored);
  };
  return {
    addPlan(chatId, plan) {
      const id = workPlans.add(chatId, plan);
      emit({ action: "plan_work", plan: id });
      return planOf(id)!;
    },

    plan(id) {
      const stored = workPlans.get(id);
      return stored && planView(stored);
    },

    latestPlan(chatId) {
      const stored = workPlans.latestOf(chatId);
      return stored && planView(stored);
    },

    plans(limit) {
      return workPlans.newest(Math.max(1, Math.min(limit, 50))).map(planView);
    },

    linkPlanJob(planId, n, job) {
      const stored = workPlans.get(planId);
      if (!stored?.portions.some((p) => p.n === n)) throw new HelperError("There is no such portion.");
      if (!get(job)) throw new HelperError(`There is no task ${job}.`);
      if (!workPlans.link(planId, n, job)) throw new HelperError(`Portion ${n} has started already.`);
      emit({ action: "plan_work", plan: planId, portion: n });
    },
  };
}
