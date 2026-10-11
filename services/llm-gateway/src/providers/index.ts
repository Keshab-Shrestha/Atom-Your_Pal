import type { ToolRunner } from "@zeno/contracts";
import type { ProviderAdapter } from "../gateway.ts";
import { createClaudePlanAdapter, type PlanUsage, type TokenUsage } from "./claude-plan.ts";

/** ADR-092: ZENO runs on the user's own Claude plan. Another provider is added here (and in @zeno/shared's PROVIDERS). */
export const PROVIDERS = ["claude-plan"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ProviderSettings {
  provider: ProviderName;
  /** For "claude-plan": the path of the signed-in `claude` program (not a secret). */
  apiKey: string;
  model: string;
  /** For "claude-plan" only: Claude Code runs the tool loop itself, so it needs ZENO's tools. */
  tools?: ToolRunner;
  /** For "claude-plan" only: told how much of the plan is used. */
  onUsage?: (usage: PlanUsage) => void;
  /** For "claude-plan" only (ADR-091): told the tokens each answer used. */
  onTokens?: (tokens: TokenUsage, model: string) => void;
}

/** Builds the configured provider adapter. The only place that knows every provider. */
export function createProviderAdapter(settings: ProviderSettings): ProviderAdapter {
  switch (settings.provider) {
    case "claude-plan":
      return createClaudePlanAdapter({
        claudePath: settings.apiKey,
        model: settings.model,
        ...(settings.tools ? { tools: settings.tools } : {}),
        ...(settings.onUsage ? { onUsage: settings.onUsage } : {}),
        ...(settings.onTokens ? { onTokens: settings.onTokens } : {}),
      });
  }
}
