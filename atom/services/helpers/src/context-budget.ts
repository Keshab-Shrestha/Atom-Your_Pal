/** Pure context composition. Source text never creates grants, routes providers or edits saved records. */
export type ContextPart =
  | { id: string; kind: "required"; text: string }
  | { id: string; kind: "support"; text: string; fallback: string; priority?: number }
  | { id: string; kind: "optional"; text: string; fallback?: string; priority?: number };

export interface ContextBudgetReceipt {
  schema: "atom.context-budget/v1";
  limitBytes: number;
  minimumBytes: number;
  renderedBytes: number;
  overLimitBytes: number;
  parts: { id: string; kind: ContextPart["kind"]; selection: "full" | "fallback" | "omitted"; offeredBytes: number; retainedBytes: number; reason: "included" | "summary_for_budget" | "beyond_context_budget" }[];
}
export interface BudgetedContext { text: string; receipt: ContextBudgetReceipt }
export const CHAT_CONTEXT_BYTES = 16_384;
export const WORKFLOW_CONTEXT_BYTES = 8_192;
const NOTICE = "Some automatically supplied background was shortened or omitted to fit this request. Consult original sources or ask for missing details before relying on an incomplete summary. This does not change permissions or saved history.";
const bytes = (text: string) => Buffer.byteLength(text, "utf8");

/** Required text is never clipped. Support keeps a minimum summary; optional blocks may be omitted whole. */
export function budgetContext(parts: readonly ContextPart[], limitBytes: number, options: { notice?: string; separator?: "\n" | "\n\n" } = {}): BudgetedContext {
  const notice = options.notice ?? NOTICE, separator = options.separator ?? "\n\n";
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) throw new Error("Invalid context byte budget.");
  const ids = new Set<string>();
  const source = parts.filter((part) => {
    if (!part || typeof part.id !== "string" || !/^[a-z0-9][a-z0-9:._-]{0,95}$/.test(part.id) || ids.has(part.id)
      || !["required", "support", "optional"].includes(part.kind) || typeof part.text !== "string"
      || part.kind === "support" && (!part.text || typeof part.fallback !== "string" || !part.fallback.trim())
      || part.kind === "optional" && part.fallback !== undefined && typeof part.fallback !== "string"
      || part.kind !== "required" && part.priority !== undefined && !Number.isFinite(part.priority)) throw new Error("Invalid or duplicate host context part.");
    ids.add(part.id);
    return part.text.length > 0;
  });
  const render = (values: readonly (string | undefined)[], omitted = false) => [...values.filter((v): v is string => Boolean(v)), ...(omitted ? [notice] : [])].join(separator);
  const full = source.map((p) => p.text);
  const minimum = source.map((p) => {
    if (p.kind === "required") return p.text;
    if (p.kind === "support") return bytes(p.fallback) < bytes(p.text) ? p.fallback : p.text;
    return undefined;
  });
  const minimumBytes = bytes(render(minimum));
  let selected: (string | undefined)[];
  let reduced = false;
  if (bytes(render(full)) <= limitBytes) selected = full;
  else {
    selected = [...minimum];
    const priority = (part: ContextPart) => part.kind === "required" ? 0 : part.priority ?? 0;
    const order = source.map((p, i) => ({ p, i })).filter(({ p }) => p.kind !== "required")
      .sort((a, b) => priority(b.p) - priority(a.p) || a.i - b.i);
    for (const { p, i } of order) {
      const choices = [p.text, ...(p.kind === "optional" && p.fallback ? [p.fallback] : [])];
      for (const candidate of choices) {
        const proposed = [...selected]; proposed[i] = candidate;
        if (bytes(render(proposed, true)) <= limitBytes) { selected = proposed; break; }
      }
    }
    reduced = selected.some((value, i) => value !== source[i]!.text);
  }
  const text = render(selected, reduced);
  const renderedBytes = bytes(text);
  return { text, receipt: { schema: "atom.context-budget/v1", limitBytes, minimumBytes, renderedBytes, overLimitBytes: Math.max(0, renderedBytes - limitBytes),
    parts: source.map((p, i) => {
      const value = selected[i];
      const selection = value === p.text ? "full" : value === undefined ? "omitted" : "fallback";
      return { id: p.id, kind: p.kind, selection, offeredBytes: bytes(p.text), retainedBytes: value === undefined ? 0 : bytes(value),
        reason: selection === "full" ? "included" : selection === "fallback" ? "summary_for_budget" : "beyond_context_budget" };
    }) } };
}
