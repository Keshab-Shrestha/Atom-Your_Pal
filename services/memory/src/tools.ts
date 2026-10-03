import type { ToolSpec } from "@zeno/contracts";
import { MemoryError, type Memory, type MemoryStore } from "./store.ts";

// ADR-058: what the model sees of memory, and the three tools it uses to change it.

/** Matches the Tool Engine's `Tool` (kept structural so memory does not depend on the engine). */
export interface MemoryTool {
  spec: ToolSpec;
  run(input: Record<string, unknown>): string;
}

export interface MemoryToolOptions {
  store: MemoryStore;
  /** Provenance for a new memory: the request it came from. Read when `remember` runs. */
  provenance: () => { source: "voice" | "text"; requestId?: string };
  /** For the log: counts and ids only, never memory text. */
  onChange?: (event: { action: "remember" | "forget"; id: number; count: number }) => void;
}

const line = (m: Memory) => `[${m.id}] ${m.text} (kept ${m.createdAt.toISOString().slice(0, 10)})`;

export function createMemoryTools(options: MemoryToolOptions): MemoryTool[] {
  const { store, provenance, onChange } = options;
  return [
    {
      spec: {
        name: "remember",
        description:
          "Keeps one short fact about the user for future conversations (it survives restarts). Use it when the user asks you " +
          "to remember something, or after they agree to you keeping a lasting fact they told you (their name, family, " +
          "preferences, important dates, how they like things done). Write the fact in the third person, self-contained, " +
          'one sentence, e.g. "Keshab\'s sister is called Asha." Never keep passwords, card numbers or other secrets.',
        inputSchema: {
          type: "object",
          properties: { fact: { type: "string", description: "The fact, one sentence, at most 300 characters." } },
          required: ["fact"],
        },
      },
      run(input) {
        const fact = String(input.fact);
        if (looksSecret(fact)) throw new MemoryError("That looks like a password or other secret; ZENO does not keep those.");
        const before = store.count();
        const memory = store.add(fact, provenance());
        const count = store.count();
        if (count === before) return `Already kept as memory ${memory.id}.`;
        onChange?.({ action: "remember", id: memory.id, count });
        return `Kept as memory ${memory.id}.`;
      },
    },
    {
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
      spec: {
        name: "forget",
        description:
          "Deletes one kept memory for good. Use it when the user asks you to forget something or says a kept fact is wrong. " +
          "Find the id first (it is shown in your instructions or by recall). To correct a fact, forget the old one and remember the new one.",
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

/** Always in the prompt when memory is on, so ZENO knows it can keep things and offers to (ADR-059). */
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

/**
 * What ZENO knows that may matter for this request: memories matching its words, then the newest, up to
 * `limit`. Returned as a block for the system prompt, or undefined when nothing is kept.
 */
export function memoryContext(request: string, options: MemoryContextOptions): string | undefined {
  const { store, limit = 12 } = options;
  const chosen = new Map<number, Memory>();
  for (const m of store.search(request, limit)) chosen.set(m.id, m);
  for (const m of store.recent(limit)) {
    if (chosen.size >= limit) break;
    chosen.set(m.id, m);
  }
  if (chosen.size === 0) return undefined;
  const total = store.count();
  const lines = [...chosen.values()].sort((a, b) => a.id - b.id).map(line);
  return [
    "What you know about the user (facts they asked you to keep; use them naturally, do not recite them unprompted):",
    ...lines,
    ...(total > chosen.size ? [`(${total - chosen.size} more kept; use recall to search them.)`] : []),
  ].join("\n");
}

/** A cheap guard: refuses facts that look like credentials. The model is also told never to keep them. */
export function looksSecret(text: string): boolean {
  return (
    /\b(password|passcode|passwd|pin code|pin is|api key|secret key|cvv|cvc|security code)\b/i.test(text) ||
    /\b(?:\d[ -]?){13,19}\b/.test(text) || // a card number
    /\b(sk|pk|ghp|xox[abp])[-_][A-Za-z0-9]{12,}/.test(text) // an API token
  );
}
