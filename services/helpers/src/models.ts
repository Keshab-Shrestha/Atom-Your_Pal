import { TIERS, type DecisionEngine, type Tier, type TierChoice } from "@zeno/decision-engine";

// ADR-083: which model a worker job runs on. Keshab's pin wins and skips the Decision Engine; otherwise the engine's
// tier, raised to the role's floor and capped at medium when the large model is off, picks the newest offered model of
// that tier's family. The engine never changes floors or the cap: they are data here.

/** The lowest tier a role may run on. Roles not listed have no floor. */
export const ROLE_FLOORS: Readonly<Record<string, Tier>> = {
  coder: "medium",
  designer: "medium",
  "financial adviser": "medium",
};

const FAMILIES: Record<Tier, string> = { small: "haiku", medium: "sonnet", large: "opus" };

/** One model the plan offers, with its tier (the `models` of the `helpers` event). */
export interface PlanModel {
  id: string;
  name: string;
  tier: Tier;
}

export interface ModelPick {
  /** Undefined only when no offered model fits any tier. */
  model?: string;
  tier: Tier;
  score?: number;
  source: "pinned" | "laya" | "fallback";
  /** For the window, in plain words (docs/island-protocol.md, `helpers`). */
  reason: string;
}

const rank = (tier: Tier) => TIERS.indexOf(tier);

/** The offered models that belong to a tier's family, in the order given (newest first). Others are left out. */
export function tieredModels(offered: readonly { id: string; name: string }[]): PlanModel[] {
  return offered.flatMap(({ id, name }) => {
    const tier = TIERS.find((t) => id.toLowerCase().includes(FAMILIES[t]));
    return tier ? [{ id, name, tier }] : [];
  });
}

/** The newest model of the tier; a missing family falls to the next tier down (then up, if nothing lower exists). */
export function modelForTier(models: readonly PlanModel[], tier: Tier): string | undefined {
  const order = [...TIERS.slice(0, rank(tier) + 1).reverse(), ...TIERS.slice(rank(tier) + 1)];
  for (const t of order) {
    const found = models.find((m) => m.tier === t);
    if (found) return found.id;
  }
  return undefined;
}

/** The engine's choice after the role's floor and the large-model switch. Pure. */
export function resolveModel(input: { role: string; choice: TierChoice; allowLarge: boolean; models: readonly PlanModel[] }): ModelPick {
  const { role, choice, allowLarge, models } = input;
  let tier = choice.tier;
  let reason = choice.source === "laya" ? `Laya: ${choice.label ?? tier}` : "Laya unavailable";
  const floor = ROLE_FLOORS[role];
  if (floor && rank(tier) < rank(floor)) {
    tier = floor;
    reason = "Role minimum";
  }
  if (!allowLarge && tier === "large") {
    tier = "medium";
    reason = "Large model off";
  }
  const model = modelForTier(models, tier);
  return { ...(model ? { model } : {}), tier, ...(choice.score !== undefined ? { score: choice.score } : {}), source: choice.source, reason };
}

/** A job's model: an offered pin skips the engine; otherwise ask the engine, then resolveModel. */
export async function chooseJobModel(input: {
  engine: Pick<DecisionEngine, "chooseTier">;
  task: string;
  role: string;
  pinnedModel: string | null | undefined;
  allowLarge: boolean;
  models: readonly PlanModel[];
}): Promise<ModelPick> {
  const { engine, task, role, pinnedModel, allowLarge, models } = input;
  const pinned = pinnedModel ? models.find((m) => m.id === pinnedModel) : undefined;
  if (pinned) return { model: pinned.id, tier: pinned.tier, source: "pinned", reason: "Pinned" };
  return resolveModel({ role, choice: await engine.chooseTier(task, role), allowLarge, models });
}
