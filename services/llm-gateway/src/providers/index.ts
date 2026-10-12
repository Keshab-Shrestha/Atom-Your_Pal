import type { ToolRunner } from "@zeno/contracts";
import type { ProviderAdapter } from "../gateway.ts";
import { createClaudePlanAdapter, type ChatSessions, type PlanUsage, type TokenUsage } from "./claude-plan.ts";
import { createCodexAdapter, createGeminiCliAdapter } from "./cli-tools.ts";

/** ADR-092, ADR-093: the signed-in tools on this Mac; Claude Code is the default. (Also in @zeno/shared's PROVIDERS.) */
export const PROVIDERS = ["claude-plan", "codex", "gemini-cli"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ProviderSettings {
  provider: ProviderName;
  /** The path of the signed-in program (`claude`, `codex` or `gemini`): not a secret. */
  apiKey: string;
  model: string;
  /** For "claude-plan" only: Claude Code runs the tool loop itself, so it needs ZENO's tools. */
  tools?: ToolRunner;
  /** For "claude-plan" only: told how much of the plan is used. */
  onUsage?: (usage: PlanUsage) => void;
  /** For "claude-plan" only (ADR-091): told the tokens each answer used. */
  onTokens?: (tokens: TokenUsage, model: string) => void;
  /** For "claude-plan" only (ADR-098 item 9): each chat's own Claude Code session. */
  chatSessions?: ChatSessions;
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
        ...(settings.chatSessions ? { chatSessions: settings.chatSessions } : {}),
      });
    case "codex":
      return createCodexAdapter({ program: settings.apiKey, model: settings.model });
    case "gemini-cli":
      return createGeminiCliAdapter({ program: settings.apiKey, model: settings.model });
  }
}
