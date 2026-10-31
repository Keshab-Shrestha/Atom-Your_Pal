import type { ToolSpec } from "@atom/contracts";
import { MemoryError, type Memory, type MemoryStore } from "./store.ts";

// ADR-058: what the model sees of memory, and the three tools it uses to change it.

/** Matches the Tool Engine's `Tool` (kept structural so memory does not depend on the engine). */
export interface MemoryTool {
  spec: ToolSpec;
  /** The "What can I ask?" line (ADR-076), as on the Tool Engine's `Tool`. */
  capability: { title: string; examples: string[] };
  run(input: Record<string, unknown>): string;
}

export interface MemoryToolOptions {
  store: MemoryStore;
  /** Provenance for a new memory: the request it came from. Read when `remember` runs. */
  provenance: () => { source: "voice" | "text"; requestId?: string };
  /** For the log: counts and ids only, never memory text. */
  onChange?: (event: { action: "remember" | "forget"; id: number; count: number }) => void;
}

const line = (m: Memory) =>
  `[${m.id}] ${m.text} (kept ${m.createdAt.toISOString().slice(0, 10)}${m.expiresAt ? `, until ${m.expiresAt.toISOString().slice(0, 10)}` : ""})`;

/** "2026-11-30" is the end of that day, UTC. Undefined when absent; an error when it is not a real date. */
function parseUntil(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : undefined;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new MemoryError("The until date must be a real day like 2026-11-30.");
  return date;
}

export function createMemoryTools(options: MemoryToolOptions): MemoryTool[] {
  const { store, provenance, onChange } = options;
  return [
    {
      capability: { title: "Remember things", examples: ["Remember that I like oat milk"] },
      spec: {
        name: "remember",
        description:
          "Keeps one short fact about the user for future conversations (it survives restarts). Use it when the user asks you " +
          "to remember something, or after they agree to you keeping a lasting fact they told you (their name, family, " +
          "preferences, important dates, how they like things done). Write the fact in the third person, self-contained, " +
          'one sentence, e.g. "Keshab\'s sister is called Asha." Never keep passwords, card numbers or other secrets.',
        inputSchema: {
          type: "object",
          properties: {
            fact: { type: "string", description: "The fact, one sentence, at most 300 characters." },
            until: { type: "string", description: "Optional. The last day the fact is true, as YYYY-MM-DD (a trip, a deadline). After it ATOM stops using the fact." },
            replaces: { type: "number", description: "Optional. The id of an older fact that this one corrects. The old fact is hidden, not deleted, and the user can undo it." },
          },
          required: ["fact"],
        },
      },
      run(input) {
        // A missing fact must not become the text "undefined" (review, 2026-10-16).
        const fact = typeof input.fact === "string" ? input.fact.trim() : "";
        if (!fact) throw new MemoryError("Say what to remember: the fact is missing or empty.");
        if (looksSecret(fact)) throw new MemoryError("That looks like a password or other secret; ATOM does not keep those.");
        const until = parseUntil(input.until);
        if (input.replaces !== undefined && input.replaces !== null) {
          const replaces = Number(input.replaces);
          if (!Number.isInteger(replaces) || replaces < 1) throw new MemoryError("The replaces id must be a whole number from a memory.");
          const memory = store.supersede(replaces, fact, provenance(), { until });
          onChange?.({ action: "remember", id: memory.id, count: store.count() });
          return `Kept as memory ${memory.id}, replacing memory ${replaces}.`;
        }
        const before = store.count();
        const memory = store.add(fact, provenance(), { until });
        const count = store.count();
        if (count === before) return `Already kept as memory ${memory.id}.`;
        onChange?.({ action: "remember", id: memory.id, count });
        return `Kept as memory ${memory.id}.`;
      },
    },
    {
      capability: { title: "Remember things", examples: ["What do you know about me?"] },
      spec: {
        name: "recall",
        description:
          "Searches the facts kept about the user. Use it when they ask what you know or remember, or when a fact you need " +
          "may be kept but is not already in your instructions. Returns matching memories with their ids.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "Words to search for. Leave out to list the newest memories." } },
        },
      },
      run(input) {
        const query = typeof input.query === "string" ? input.query : "";
        const found = query.trim() ? store.search(query, 10) : store.recent(10);
        if (found.length === 0) return query.trim() ? "Nothing kept matches that." : "Nothing is kept yet.";
        const total = store.count();
        return `${found.map(line).join("\n")}${total > found.length ? `\n(${total} memories kept in all.)` : ""}`;
      },
    },
    {
      capability: { title: "Remember things", examples: ["Forget that I like oat milk"] },
      spec: {
        name: "forget",
        description:
          "Deletes one kept memory for good. Use it when the user asks you to forget something or says a kept fact is wrong. " +
          "Find the id first (it is shown in your instructions or by recall). To correct a fact, use remember with replaces instead: the old fact is then kept hidden and the user can undo.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "number", description: "The memory's id." } },
          required: ["id"],
        },
      },
      run(input) {
        const id = Number(input.id);
        if (!Number.isInteger(id) || id < 1) throw new MemoryError("The id must be a whole number from a memory.");
        const memory = store.get(id);
        if (!memory) return `There is no memory ${id}.`;
        store.remove(id);
        onChange?.({ action: "forget", id, count: store.count() });
        return `Forgot memory ${id}: ${memory.text}`;
      },
    },
  ];
}

/** Always in the prompt when memory is on, so ATOM knows it can keep things and offers to (ADR-059). */
export const MEMORY_GUIDANCE =
  "You can keep facts about the user between conversations with the remember tool. When the user mentions a lasting " +
  "personal fact or preference in passing (family, home, work, diet, routines, how they like things done), briefly offer " +
  "to remember it at the end of your reply, and keep it only if they agree. Never offer for one-off details, and never " +
  "keep passwords, PINs or other secrets. Do not offer again for something already kept.";

export interface MemoryContextOptions {
  store: MemoryStore;
  /** Most memories put in front of the model per request. */
  limit?: number;
}

/** Host selection metadata only: no fact text, search query or inferred model use. */
export interface MemorySelection {
  total: number;
  chosen: { id: number; via: "match" | "recent" }[];
}

/**
 * What ATOM knows that may matter for this request: memories matching its words, then the newest, up to
 * `limit`. Returned as a block for the system prompt, or undefined when nothing is kept.
 */
export function memoryContext(request: string, options: MemoryContextOptions): string | undefined {
  return memoryContextSelection(request, options).text;
}

/** The same selection/rendering as memoryContext, with an additive host receipt. */
export function memoryContextSelection(request: string, options: MemoryContextOptions): { text?: string; selection: MemorySelection } {
  const { store, limit = 12 } = options;
  const chosen = new Map<number, Memory>();
  const reasons = new Map<number, "match" | "recent">();
  for (const m of store.search(request, limit)) { chosen.set(m.id, m); reasons.set(m.id, "match"); }
  for (const m of store.recent(limit)) {
    if (chosen.size >= limit) break;
    if (!chosen.has(m.id)) reasons.set(m.id, "recent");
    chosen.set(m.id, m);
  }
  const total = store.count();
  const selection: MemorySelection = { total, chosen: [...chosen.keys()].sort((a, b) => a - b).map((id) => ({ id, via: reasons.get(id)! })) };
  if (chosen.size === 0) return { selection };
  const lines = [...chosen.values()].sort((a, b) => a.id - b.id).map(line);
  return { selection, text: [
    "What you know about the user (facts they asked you to keep; use them naturally, do not recite them unprompted):",
    ...lines,
    ...(total > chosen.size ? [`(${total - chosen.size} more kept; use recall to search them.)`] : []),
  ].join("\n") };
}

/** A run of 13 to 19 digits that passes the Luhn check and does not follow a "+" (an international phone number is long but not a card). */
function hasCardNumber(text: string): boolean {
  for (const m of text.matchAll(/(?<![\d+])(?:\d[ -]?){12,18}\d(?!\d)/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

/** A cheap guard: refuses facts that look like credentials. The model is also told never to keep them. */
export function looksSecret(text: string): boolean {
  return (
    /\b(password|passcode|passwd|pin code|pin is|api key|secret key|cvv|cvc|security code)\b/i.test(text) ||
    hasCardNumber(text) ||
    /\b(sk|pk|ghp|xox[abp])[-_][A-Za-z0-9]{12,}/.test(text) // an API token
  );
}
