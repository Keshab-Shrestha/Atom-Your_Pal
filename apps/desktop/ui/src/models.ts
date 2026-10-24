// The model picker's data rules. Ports of ModelPickerCatalog.swift, ModelInfo.isValidModelId / modelName and ChatReasoning.title. Pure.

import type { ChatAccessMode } from "./protocol.ts";

export interface ProviderInfo {
  id: string;
  name: string;
  available: boolean;
  models: { id: string; name: string }[];
}

export interface ModelEntry {
  provider: string;
  providerName: string;
  model: string;
  name: string;
  available: boolean;
}

/** Equal model ids under different providers stay separate. */
export const entryKey = (e: Pick<ModelEntry, "provider" | "model">) => `${e.provider}/${e.model}`;

/** Provider order is kept, duplicates removed, and the model in use is listed even when its provider's catalog lacks it (a custom model). */
export function buildEntries(providers: ProviderInfo[], currentProvider: string, currentModel: string): ModelEntry[] {
  const seen = new Set<string>();
  const out: ModelEntry[] = [];
  for (const p of providers) {
    const models = p.models.some((m) => m.id === currentModel) || p.id !== currentProvider ? p.models : [...p.models, { id: currentModel, name: currentModel }];
    for (const m of models) {
      const entry: ModelEntry = { provider: p.id, providerName: p.name, model: m.id, name: m.name, available: p.available };
      if (!seen.has(entryKey(entry))) {
        seen.add(entryKey(entry));
        out.push(entry);
      }
    }
  }
  return out;
}

/** Every word of the query must appear in the name, the id or the provider's name (case and accents ignored). */
export function filterEntries(entries: ModelEntry[], query: string, provider: string | undefined): ModelEntry[] {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  return entries.filter((e) => (provider === undefined || e.provider === provider) && words.every((w) => [e.name, e.model, e.providerName].some((f) => fold(f).includes(w))));
}

/** A custom model id: 1 to 100 letters, digits, ".", "_", ":" or "-" (the runtime checks again). */
export const isValidModelId = (id: string) => id.length >= 1 && id.length <= 100 && /^[A-Za-z0-9._:-]+$/.test(id);

/** A model's name from its provider's list, else the id itself. */
export function modelName(providers: ProviderInfo[], provider: string, model: string): string {
  return providers.find((p) => p.id === provider)?.models.find((m) => m.id === model)?.name ?? model;
}

export function reasoningTitle(level: string): string {
  if (level === "off" || level === "none") return "Off";
  if (level === "xhigh") return "Extra high";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export const ACCESS_MODES: { mode: ChatAccessMode; title: string; detail: string }[] = [
  { mode: "checked", title: "Saved permissions", detail: "Use existing checked tools and saved file permissions." },
  { mode: "chat-only", title: "Chat only", detail: "Use conversation and saved brief only; no tools or new file or screen reads." },
  { mode: "ask-changes", title: "Ask before changes", detail: "Ask for each change-capable call, including edits to previously allowed files." },
  { mode: "full", title: "Full access", detail: "Skip routine file, classified-command, worker site-opening and granted-plugin prompts. Protected actions still ask or refuse. Only this chat." },
];

/** The Gemini CLI cannot enforce the stricter modes, so only Saved permissions is offered with it. */
export const needsClaudeOrCodex = (provider: string | undefined) => provider === "gemini-cli";
