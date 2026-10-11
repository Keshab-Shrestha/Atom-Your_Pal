import type { ToolRunner } from "@zeno/contracts";
import type { ProviderAdapter } from "../gateway.ts";
import { createClaudeAdapter } from "./claude.ts";
import { createClaudePlanAdapter, type PlanUsage, type TokenUsage } from "./claude-plan.ts";
import { createGeminiAdapter } from "./gemini.ts";

export const PROVIDERS = ["claude", "claude-plan", "gemini"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ProviderSettings {
  provider: ProviderName;
  /** The API key. For "claude-plan" it is the path of the signed-in `claude` program instead (not a secret). */
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
    case "claude":
      return createClaudeAdapter({ apiKey: settings.apiKey, model: settings.model });
    case "claude-plan":
      return createClaudePlanAdapter({
        claudePath: settings.apiKey,
        model: settings.model,
        ...(settings.tools ? { tools: settings.tools } : {}),
        ...(settings.onUsage ? { onUsage: settings.onUsage } : {}),
        ...(settings.onTokens ? { onTokens: settings.onTokens } : {}),
      });
    case "gemini":
      return createGeminiAdapter({ apiKey: settings.apiKey, model: settings.model });
  }
}
