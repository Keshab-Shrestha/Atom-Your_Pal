import type { ToolCall, ToolImage, ToolResult, ToolRunner, ToolSpec } from "@ark/contracts";

/** One line of the island's "What can I ask?" page (ADR-076): a plain title and phrases that really work. */
export interface Capability {
  title: string;
  examples: string[];
}

/** Words for the model plus images (ADR-080: a screenshot). */
export interface ToolOutput {
  text: string;
  images?: ToolImage[];
}

/** A capability ARK can run for the model. `run` returns words (or `ToolOutput`: words and images) for the model, or throws to report failure. */
export interface Tool<Out extends string | ToolOutput = string> {
  spec: ToolSpec;
  /** What the user can ask for with this tool. Every user-facing tool has one (the tool engine's tests check). */
  capability?: Capability;
  run(input: Record<string, unknown>, signal?: AbortSignal): Promise<Out> | Out;
}

export interface ToolEngineOptions {
  tools: Array<Tool<string | ToolOutput>>;
  /** Called after every call, including refused ones, for the log. Never receives tool output. */
  onCall?: (event: { name: string; ok: boolean; reason?: string; ms: number; repeat?: number }) => void;
  /** Longest result handed back to the model. Longer output is cut and says so. */
  maxResultChars?: number;
  now?: () => number;
}

/** The model made the same call this many times in one turn: from now on each result carries a reminder (2026-11-05, idea from deepseek-harness). */
export const REPEAT_REMINDER_AT = 3;
const MAX_TRACKED_CALLS = 200;
const stable = (value: unknown): string =>
  Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(value) ?? "null";
export const repeatReminder = (name: string, count: number) =>
  `\n[Reminder: this is call ${count} to "${name}" with the same input in this turn. If nothing changed since the last one, the result will not change. Try a different step, or tell the user what blocks you.]`;

/**
 * Tool Engine: the one place model-chosen tool calls are validated and run (SECURITY.md: tool arguments
 * from a model are untrusted). Unknown tools, bad arguments and tool failures all come back as error
 * results the model can read; nothing here throws into the Core.
 */
export function createToolEngine(options: ToolEngineOptions): ToolRunner {
  const { tools, onCall, maxResultChars = 8000, now = Date.now } = options;
  const byName = new Map(tools.map((t) => [t.spec.name, t]));
  if (byName.size !== tools.length) throw new Error("Two tools share a name");
  // Identical calls per turn. A turn is one abort signal; a call with no signal is not counted.
  const perTurn = new WeakMap<AbortSignal, Map<string, number>>();
  const countCall = (call: ToolCall, signal?: AbortSignal): number => {
    if (!signal) return 1;
    let seen = perTurn.get(signal);
    if (!seen) perTurn.set(signal, (seen = new Map()));
    const key = `${call.name}:${stable(call.input)}`;
    const count = (seen.get(key) ?? 0) + 1;
    if (seen.size >= MAX_TRACKED_CALLS && !seen.has(key)) seen.clear();
    seen.set(key, count);
    return count;
  };

  return {
    specs: () => tools.map((t) => t.spec),

    async run(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
      const started = now();
      const repeat = countCall(call, signal);
      const finish = (words: string, ok: boolean, reason?: string, images?: ToolImage[]): ToolResult => {
        onCall?.({ name: call.name, ok, ...(reason ? { reason } : {}), ms: now() - started, ...(repeat >= REPEAT_REMINDER_AT ? { repeat } : {}) });
        const content = repeat >= REPEAT_REMINDER_AT ? words + repeatReminder(call.name, repeat) : words;
        if (!ok) return { callId: call.id, content, isError: true };
        return images?.length ? { callId: call.id, content, images } : { callId: call.id, content };
      };

      const tool = byName.get(call.name);
      if (!tool) return finish(`There is no tool called "${call.name}".`, false, "unknown_tool");
      const problem = checkInput(tool.spec, call.input);
      if (problem) return finish(`The input for "${call.name}" is not valid: ${problem}`, false, "bad_input");
      if (signal?.aborted) return finish("Cancelled before it ran.", false, "cancelled");

      try {
        const result = await tool.run(call.input, signal);
        const { text: out, images } = typeof result === "object" && result !== null ? result : { text: String(result), images: undefined };
        const text = out.length > maxResultChars ? `${out.slice(0, maxResultChars)}\n[cut: ${out.length - maxResultChars} more characters]` : out;
        return finish(text, true, undefined, images);
      } catch (error) {
        return finish(`"${call.name}" failed: ${error instanceof Error ? error.message : String(error)}`, false, "failed");
      }
    },
  };
}

/** Checks the input against the tool's own schema: an object, required fields present, declared types right. */
function checkInput(spec: ToolSpec, input: unknown): string | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return "it must be an object";
  const record = input as Record<string, unknown>;
  const props = spec.inputSchema.properties ?? {};
  for (const key of spec.inputSchema.required ?? []) {
    if (!(key in record)) return `"${key}" is missing`;
  }
  for (const [key, value] of Object.entries(record)) {
    const declared = props[key];
    if (!declared) return `"${key}" is not an input of this tool`;
    const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (declared.type !== actual) return `"${key}" must be ${declared.type}, not ${actual}`;
  }
  return undefined;
}

/**
 * The "What can I ask?" list (ADR-076) for the tools that are on: tools with the same title become one item,
 * examples concatenated without repeats, in the order the tools are registered. Tools without one are left out.
 */
export function capabilityItems(tools: ReadonlyArray<{ capability?: Capability }>): Capability[] {
  const byTitle = new Map<string, string[]>();
  for (const { capability } of tools) {
    if (!capability) continue;
    byTitle.set(capability.title, [...new Set([...(byTitle.get(capability.title) ?? []), ...capability.examples])]);
  }
  return [...byTitle].map(([title, examples]) => ({ title, examples }));
}
