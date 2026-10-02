// ZENO Island's runtime settings: which AI provider and model to use (ADR-038, ADR-040).
// The choice is switched live by the `model.set` command and saved in config/island.json, which
// overrides ZENO_LLM_PROVIDER / ZENO_LLM_MODEL at the next start. API keys stay in .env: they are
// never written to the settings file, sent to the island, logged or put in a message.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SwitchableModel } from "@zeno/llm-gateway";
import { LLM_PROVIDER_IDS, PROVIDERS, isLlmProvider, type LlmChoice, type Logger, type ProviderKeys } from "@zeno/shared";
import type { InfoEvent } from "./island-protocol.ts";

/** Where the settings file lives, relative to the project root (the working directory, like logs/). */
export const DEFAULT_SETTINGS_PATH = "config/island.json";

export function settingsPath(env: Record<string, string | undefined> = process.env): string {
  return env.ZENO_ISLAND_SETTINGS?.trim() || DEFAULT_SETTINGS_PATH;
}

const shorten = (text: string) => (text.length > 40 ? `${text.slice(0, 40)}…` : text);

/**
 * Reads the saved choice. A missing file is silent (`{}`); a file that cannot be used gives a
 * `warning` to log and is otherwise ignored. Never throws.
 */
export function readSavedChoice(path: string, keys: ProviderKeys): { choice?: LlmChoice; warning?: string } {
  if (!existsSync(path)) return {};
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const reason = error instanceof SyntaxError ? "it is not valid JSON" : error instanceof Error ? error.message : String(error);
    return { warning: `Ignoring ${path}: ${reason}. Using the model from .env.` };
  }
  const llm = (value as { llm?: { provider?: unknown; model?: unknown } } | null)?.llm;
  if (typeof llm?.provider !== "string" || typeof llm.model !== "string" || llm.model.trim() === "") {
    return { warning: `Ignoring ${path}: expected {"llm":{"provider":"…","model":"…"}}. Using the model from .env.` };
  }
  if (!isLlmProvider(llm.provider)) {
    return { warning: `Ignoring ${path}: unknown provider "${shorten(llm.provider)}". Using the model from .env.` };
  }
  if (!keys[llm.provider]) {
    const { name, keyVar } = PROVIDERS[llm.provider];
    return { warning: `Ignoring ${path}: it chooses ${name}, but ${keyVar} is not in .env. Using the model from .env.` };
  }
  return { choice: { provider: llm.provider, model: llm.model.trim() } };
}

/** Saves the choice atomically (temporary file, then rename), creating the directory if needed. */
export function writeSavedChoice(path: string, choice: LlmChoice): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ llm: { provider: choice.provider, model: choice.model } }, null, 2)}\n`);
  renameSync(temporary, path);
}

/**
 * The models offered for a provider: the table in PROVIDERS, plus the model configured at startup
 * (from .env or config/island.json) when it is not in the table, so it can always be chosen again.
 */
export function offeredModels(provider: string, configured: LlmChoice): { id: string; name: string }[] {
  if (!isLlmProvider(provider)) return [];
  const models: { id: string; name: string }[] = PROVIDERS[provider].models.map(({ id, name }) => ({ id, name }));
  if (configured.provider === provider && !models.some((m) => m.id === configured.model)) {
    models.push({ id: configured.model, name: configured.model });
  }
  return models;
}

export type SetModelResult = { ok: true } | { error: string };

export interface ModelSettings {
  current(): LlmChoice;
  /** The `info` event's fields: the model in use and the choices. Contains no keys. */
  info(): Omit<InfoEvent, "type">;
  /** Validates and applies a choice. On an error nothing changes. */
  setModel(provider: string, model: string): SetModelResult;
}

export interface ModelSettingsOptions {
  /** The choice in use at startup; also counts as offered (see offeredModels). */
  initial: LlmChoice;
  /** Every provider key present in .env. */
  keys: ProviderKeys;
  /** The Core's model; its gateway is replaced on a switch. */
  model: SwitchableModel;
  /** Builds the gateway for a choice. */
  createModel(choice: LlmChoice, apiKey: string): Parameters<SwitchableModel["replace"]>[0];
  /** Persists a choice; throws on failure. */
  save(choice: LlmChoice): void;
  log?: Pick<Logger, "info" | "warn">;
}

export function createModelSettings(options: ModelSettingsOptions): ModelSettings {
  const { initial, keys, model, log } = options;
  let current: LlmChoice = { ...initial };

  return {
    current: () => ({ ...current }),

    info() {
      return {
        provider: current.provider,
        model: current.model,
        providers: LLM_PROVIDER_IDS.map((id) => ({
          id,
          name: PROVIDERS[id].name,
          available: Boolean(keys[id]),
          models: offeredModels(id, initial),
        })),
      };
    },

    setModel(provider, modelId) {
      if (!isLlmProvider(provider)) {
        const names = LLM_PROVIDER_IDS.map((id) => PROVIDERS[id].name).join(" or ");
        return { error: `Unknown AI provider "${shorten(provider)}". Choose ${names}.` };
      }
      const { name, keyVar } = PROVIDERS[provider];
      const apiKey = keys[provider];
      if (!apiKey) return { error: `Add ${keyVar} to .env to use ${name}, then restart ZENO.` };
      if (!offeredModels(provider, initial).some((m) => m.id === modelId)) {
        return { error: `"${shorten(modelId)}" is not a ${name} model ZENO offers. Choose one from the list.` };
      }

      const choice: LlmChoice = { provider, model: modelId };
      model.replace(options.createModel(choice, apiKey));
      current = choice;
      log?.info("model.set", { provider, model: modelId });

      // The switch has happened either way; failing to save only loses the choice at the next start.
      try {
        options.save(choice);
      } catch (error) {
        log?.warn("settings.save_failed", { message: error instanceof Error ? error.message : String(error) });
      }
      return { ok: true };
    },
  };
}
