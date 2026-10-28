import { ProviderError, type ProviderAdapter } from "../gateway.ts";
import { createCodexAdapter, createGeminiCliAdapter } from "./cli-tools.ts";

/** ADR-092, ADR-093: the signed-in tools on this Mac; Claude Code is the default. (Also in @atom/shared's PROVIDERS.) */
export const PROVIDERS = ["claude-plan", "codex", "gemini-cli"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ProviderSettings {
  provider: ProviderName;
  /** The path of the signed-in program (`claude`, `codex` or `gemini`): not a secret. */
  apiKey: string;
  model: string;
}

/** Builds the configured provider adapter. The only place that knows every provider. */
export function createProviderAdapter(settings: ProviderSettings): ProviderAdapter {
  switch (settings.provider) {
    case "claude-plan":
      // ADR-110 N5: the Claude plan answers in ATOM's native sessions (apps/mac), never through the gateway.
      return {
        name: "claude-plan",
        complete: () => Promise.reject(new ProviderError("bad_request", "The Claude plan answers in ATOM's own chat sessions, not through the gateway.")),
      };
    case "codex":
      return createCodexAdapter({ program: settings.apiKey, model: settings.model });
    case "gemini-cli":
      return createGeminiCliAdapter({ program: settings.apiKey, model: settings.model });
  }
}
