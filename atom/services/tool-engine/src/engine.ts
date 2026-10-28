import type { ToolCall, ToolImage, ToolResult, ToolRunner, ToolSpec } from "@atom/contracts";

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

/** A capability ATOM can run for the model. `run` returns words (or `ToolOutput`: words and images) for the model, or throws to report failure. */
export interface Tool<Out extends string | ToolOutput = string> {
  spec: ToolSpec;
  /** What the user can ask for with this tool. Every user-facing tool has one (the tool engine's tests check). */
  capability?: Capability;
  run(input: Record<string, unknown>, signal?: AbortSignal): Promise<Out> | Out;
}

export interface ToolEngineOptions {
  tools: Array<Tool<string | ToolOutput>>;
  /** Called after every call, including refused ones, for the log. Never receives tool output. */
  onCall?: (event: { name: string; ok: boolean; reason?: string; ms: number }) => void;
  /** Longest result handed back to the model. Longer output is cut and says so. */
  maxResultChars?: number;
  now?: () => number;
}

/**
 * Tool Engine: the one place model-chosen tool calls are validated and run (SECURITY.md: tool arguments
 * from a model are untrusted). Unknown tools, bad arguments and tool failures all come back as error
 * results the model can read; nothing here throws into the Core.
 */
export function createToolEngine(options: ToolEngineOptions): ToolRunner {
  const { tools, onCall, maxResultChars = 8000, now = Date.now } = options;
  const byName = new Map(tools.map((t) => [t.spec.name, t]));
  if (byName.size !== tools.length) throw new Error("Two tools share a name");

  return {
    specs: () => tools.map((t) => t.spec),

    async run(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
      const started = now();
      const finish = (content: string, ok: boolean, reason?: string, images?: ToolImage[]): ToolResult => {
        onCall?.({ name: call.name, ok, ...(reason ? { reason } : {}), ms: now() - started });
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
