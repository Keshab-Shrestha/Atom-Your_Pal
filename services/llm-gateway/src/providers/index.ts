import type { ProviderAdapter } from "../gateway.ts";
import { createClaudeAdapter } from "./claude.ts";
import { createGeminiAdapter } from "./gemini.ts";

export const PROVIDERS = ["claude", "gemini"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ProviderSettings {
  provider: ProviderName;
  apiKey: string;
  model: string;
}

/** Builds the configured provider adapter. The only place that knows every provider. */
export function createProviderAdapter(settings: ProviderSettings): ProviderAdapter {
  switch (settings.provider) {
    case "claude":
      return createClaudeAdapter({ apiKey: settings.apiKey, model: settings.model });
    case "gemini":
      return createGeminiAdapter({ apiKey: settings.apiKey, model: settings.model });
  }
}
