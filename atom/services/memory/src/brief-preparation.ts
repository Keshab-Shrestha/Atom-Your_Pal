import { validChatBrief } from "./chats.ts";

export interface PreparationSource { id: string; label: string; text: string; collectedAt: string }
export interface PreparedCard { title: string; body: string; sources: PreparationSource[] }
export interface BriefPreparation {
  status: "ready" | "empty" | "budget" | "failed";
  cards: PreparedCard[];
  provider?: string;
  model?: string;
}
export interface PreparationBudget { day: string; used: number; limit: number }

/** Kept derived work is inert text, never a tool call, recipient, URL action or approval. */
export function checkedBriefPreparation(value: unknown): BriefPreparation {
  if (!value || typeof value !== "object" || Buffer.byteLength(JSON.stringify(value)) > 24_000) throw new Error("Invalid prepared work.");
  const row = value as Record<string, unknown>;
  if (!["ready", "empty", "budget", "failed"].includes(String(row.status)) || !Array.isArray(row.cards) || row.cards.length > 3) throw new Error("Invalid preparation status/cards.");
  const text = (value: unknown) => {
    if (!validChatBrief(value) || !value.trim()) throw new Error("Invalid prepared text.");
    return value;
  };
  const cards = row.cards.map((value): PreparedCard => {
    if (!value || typeof value !== "object") throw new Error("Invalid prepared card.");
    const card = value as Record<string, unknown>;
    if (!Array.isArray(card.sources) || !card.sources.length || card.sources.length > 4) throw new Error("Prepared work needs source excerpts.");
    return { title: text(card.title), body: text(card.body), sources: card.sources.map((value): PreparationSource => {
      if (!value || typeof value !== "object") throw new Error("Invalid preparation source.");
      const source = value as Record<string, unknown>;
      if (typeof source.id !== "string" || !/^[a-zA-Z]+:[1-9][0-9]?$/.test(source.id)
        || typeof source.collectedAt !== "string" || !Number.isFinite(Date.parse(source.collectedAt))) throw new Error("Invalid source identity/time.");
      return { id: source.id, label: text(source.label), text: text(source.text), collectedAt: source.collectedAt };
    }) };
  });
  if ((row.status === "ready") !== Boolean(cards.length)) throw new Error("Preparation status does not match its cards.");
  return { status: row.status as BriefPreparation["status"], cards,
    ...(row.provider !== undefined ? { provider: text(row.provider) } : {}), ...(row.model !== undefined ? { model: text(row.model) } : {}) };
}
