// ZENO Island's runtime settings: which Claude model to use on the plan (ADR-038, ADR-040, ADR-092).
// The choice is switched live by the `model.set` command and saved in config/island.json, which
// overrides ZENO_LLM_PROVIDER / ZENO_LLM_MODEL at the next start. API keys stay in .env: they are
// never written to the settings file, sent to the island, logged or put in a message.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SwitchableModel } from "@zeno/llm-gateway";
import { LLM_PROVIDER_IDS, PROVIDERS, RETIRED_PROVIDERS, isLlmProvider, type LlmChoice, type Logger, type ProviderKeys } from "@zeno/shared";
import type { InfoEvent } from "./island-protocol.ts";
import type { AiToolItem } from "./ai-tools.ts";

/** Where the settings file lives, relative to the project root (the working directory, like logs/). */
export const DEFAULT_SETTINGS_PATH = "config/island.json";

export function settingsPath(env: Record<string, string | undefined> = process.env): string {
  return env.ZENO_ISLAND_SETTINGS?.trim() || DEFAULT_SETTINGS_PATH;
}

/** ADR-093: for each provider's program, what is missing (a clause) and how to get it (an instruction). */
const SIGN_IN: Record<keyof typeof PROVIDERS, { missing: string; todo: string }> = {
  "claude-plan": {
    missing: "the signed-in `claude` program was not found (install Claude Code and run `claude auth login`)",
    todo: "Install Claude Code and run `claude auth login`",
  },
  codex: {
    missing: "Codex was not found or is not signed in (run `codex login`)",
    todo: "Install Codex and run `codex login`",
  },
  "gemini-cli": {
    missing: "the Gemini CLI was not found or is not signed in (run `gemini` and sign in with Google)",
    todo: "Install the Gemini CLI, run `gemini` and sign in with Google",
  },
};

/** What is missing for a provider, as a clause: its program, found and signed in. */
export function missingKeyAdvice(provider: keyof typeof PROVIDERS): string {
  return SIGN_IN[provider].missing;
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
  if ((RETIRED_PROVIDERS as readonly string[]).includes(llm.provider)) {
    return { warning: `Ignoring ${path}: it chooses ${llm.provider}, which ZENO no longer uses (it runs on your Claude plan).` };
  }
  if (!isLlmProvider(llm.provider)) {
    return { warning: `Ignoring ${path}: unknown provider "${shorten(llm.provider)}". Using the model from .env.` };
  }
  if (!keys[llm.provider]) {
    return { warning: `Ignoring ${path}: it chooses ${PROVIDERS[llm.provider].name}, but ${missingKeyAdvice(llm.provider)}. Using the model from .env.` };
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

/** ADR-097: a model id Keshab types ("Custom model…"): 1 to 100 letters, digits, ".", "_", ":" or "-". */
export const CUSTOM_MODEL_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

export function isValidModelId(id: string): boolean {
  return CUSTOM_MODEL_PATTERN.test(id);
}

/**
 * The models offered for a provider: its live list (ADR-097: the Claude plan's, from the Agent SDK) or else the table
 * in PROVIDERS, plus the model configured at startup (from .env or config/island.json) and any other choice in use
 * (`extra`, such as a custom model id) when they are not in the list, so they can always be chosen again.
 */
export function offeredModels(
  provider: string,
  configured: LlmChoice,
  live?: readonly { id: string; name: string }[],
  extra: readonly LlmChoice[] = [],
): { id: string; name: string }[] {
  if (!isLlmProvider(provider)) return [];
  const base = live?.length ? live : PROVIDERS[provider].models;
  const models: { id: string; name: string }[] = base.map(({ id, name }) => ({ id, name }));
  for (const choice of [configured, ...extra]) {
    if (choice.provider === provider && !models.some((m) => m.id === choice.model)) models.push({ id: choice.model, name: choice.model });
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
  /** ADR-097: validates a choice without applying it (a chat's own model): an offered model or a valid custom id. */
  check(provider: string, model: string): { choice: LlmChoice } | { error: string };
  /** ADR-097: asks the Claude plan for its models again; on a failure the last list (or the table) stays. */
  refreshModels?(): Promise<void>;
  /** ADR-093: looks for the AI tools on this Mac again; `info()` then lists them. */
  scanTools?(): Promise<void>;
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
  /** ADR-093: finds the AI tools on this Mac (found, signed in). */
  scan?(): Promise<AiToolItem[]>;
  /** ADR-097: the Claude plan's models, live (Agent SDK `supportedModels()`), given the `claude` program's path. */
  listPlanModels?(claudePath: string): Promise<{ id: string; name: string }[]>;
}

export function createModelSettings(options: ModelSettingsOptions): ModelSettings {
  const { initial, keys, model, log } = options;
  let current: LlmChoice = { ...initial };
  let tools: AiToolItem[] = [];
  /** ADR-097: the last live model list per provider; absent means the table in PROVIDERS. */
  const live: Partial<Record<keyof typeof PROVIDERS, { id: string; name: string }[]>> = {};
  const offered = (id: string) => offeredModels(id, initial, isLlmProvider(id) ? live[id] : undefined, [current]);

  function check(provider: string, modelId: string): { choice: LlmChoice } | { error: string } {
    if (!isLlmProvider(provider)) {
      const names = LLM_PROVIDER_IDS.map((id) => PROVIDERS[id].name).join(" or ");
      return { error: `Unknown AI provider "${shorten(provider)}". Choose ${names}.` };
    }
    const { name } = PROVIDERS[provider];
    if (!keys[provider]) return { error: `${SIGN_IN[provider].todo} to use ${name}, then restart ZENO.` };
    if (!offered(provider).some((m) => m.id === modelId) && !isValidModelId(modelId)) {
      return { error: `"${shorten(modelId)}" is not a model id: use 1 to 100 letters, digits, ".", "_", ":" or "-".` };
    }
    return { choice: { provider, model: modelId } };
  }
  /** A provider can be chosen when its program is here and is not known to be signed out. */
  const usable = (id: keyof typeof PROVIDERS) => Boolean(keys[id]) && tools.find((t) => t.provider === id)?.signedIn !== false;

  return {
    current: () => ({ ...current }),

    info() {
      return {
        provider: current.provider,
        model: current.model,
        providers: LLM_PROVIDER_IDS.map((id) => ({
          id,
          name: PROVIDERS[id].name,
          available: usable(id),
          models: offered(id),
        })),
        tools,
      };
    },

    async scanTools() {
      if (!options.scan) return;
      tools = await options.scan();
      log?.info("tools.scan", { found: tools.filter((t) => t.found).map((t) => t.id).join(",") });
    },

    check,

    async refreshModels() {
      const claudePath = keys["claude-plan"];
      if (!options.listPlanModels || !claudePath) return;
      try {
        const found = await options.listPlanModels(claudePath);
        if (found.length) live["claude-plan"] = found;
        log?.info("models.refresh", { provider: "claude-plan", count: found.length });
      } catch (error) {
        log?.warn("models.refresh_failed", { provider: "claude-plan", message: error instanceof Error ? error.message : String(error) });
      }
    },

    setModel(provider, modelId) {
      const checked = check(provider, modelId);
      if ("error" in checked) return checked;
      const { choice } = checked;
      model.replace(options.createModel(choice, keys[choice.provider]!));
      current = choice;
      log?.info("model.set", { provider: choice.provider, model: modelId });

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
