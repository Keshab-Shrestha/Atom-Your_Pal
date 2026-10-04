import Anthropic from "@anthropic-ai/sdk";
import type { Message, ModelRequest, ModelResponse, ToolCall } from "@zeno/contracts";
import { emptyReplyReason, ProviderError, type ErrorKind, type ProviderAdapter, systemText } from "../gateway.ts";

/** The subset of the Anthropic client this adapter uses (lets tests supply a fake). */
export interface ClaudeClient {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<{
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason?: string | null;
    }>;
  };
}

export interface ClaudeOptions {
  apiKey: string;
  model: string;
  /** Upper bound on reply length. Spoken replies are short, so this stays modest. */
  maxTokens?: number;
  client?: ClaudeClient;
}

/**
 * Claude provider adapter (ADR-028). All Anthropic-specific code lives here.
 * Retries and timeouts are the gateway's job, so the SDK's own retries are disabled.
 */
export function createClaudeAdapter(options: ClaudeOptions): ProviderAdapter {
  const { apiKey, model, maxTokens = 1024 } = options;
  const client: ClaudeClient = options.client ?? new Anthropic({ apiKey, maxRetries: 0 });

  return {
    name: "claude",
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
      let message;
      try {
        message = await client.messages.create(
          {
            model,
            max_tokens: maxTokens,
            system: systemText(request),
            messages: request.messages.map(toClaudeMessage),
            ...(request.tools?.length
              ? { tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }
              : {}),
          },
          { signal },
        );
      } catch (error) {
        if (signal.aborted) throw error; // the gateway reports its own timeout
        throw toProviderError(error, model);
      }
      if (!message || !Array.isArray(message.content)) {
        throw new ProviderError("unknown", "Claude sent a reply ZENO could not read (no content). Try again.");
      }
      const text = message.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("")
        .trim();
      const toolCalls: ToolCall[] = message.content
        .filter((block) => block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string")
        .map((block) => ({
          id: block.id as string,
          name: block.name as string,
          input: block.input && typeof block.input === "object" ? (block.input as Record<string, unknown>) : {},
        }));
      if (toolCalls.length) return { text, toolCalls };
      if (!text) throw new ProviderError("bad_request", emptyReplyReason("claude", message.stop_reason));
      return { text };
    },
  };
}

/** Plain turns stay plain strings; turns with tool calls or results become Anthropic content blocks. */
function toClaudeMessage(m: Message): Anthropic.MessageParam {
  if (m.toolCalls?.length) {
    const blocks: Anthropic.ContentBlockParam[] = [];
    if (m.content) blocks.push({ type: "text", text: m.content });
    for (const c of m.toolCalls) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
    return { role: "assistant", content: blocks };
  }
  if (m.toolResults?.length) {
    return {
      role: "user",
      content: m.toolResults.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.callId,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function toProviderError(error: unknown, model: string): ProviderError {
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    const detail = apiMessage(error);
    const kind = classify(error, status);
    const hint =
      kind === "auth"
        ? " Check ANTHROPIC_API_KEY in .env."
        : status === 404
          ? ` Check ZENO_LLM_MODEL ("${model}").`
          : "";
    return new ProviderError(kind, `${status ? `HTTP ${status}: ` : ""}${detail}${hint}`);
  }
  return new ProviderError("unknown", error instanceof Error ? error.message : String(error));
}

function classify(error: InstanceType<typeof Anthropic.APIError>, status: number | undefined): ErrorKind {
  if (error instanceof Anthropic.APIConnectionError) return "unavailable";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status !== undefined && status >= 500) return "unavailable"; // includes 529 overloaded
  if (status !== undefined && status >= 400) return "bad_request";
  return "unknown";
}

/** Extracts Anthropic's human-readable message without dumping headers or request details. */
function apiMessage(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? (error instanceof Anthropic.APIConnectionError ? "Could not reach the Anthropic API" : error.message);
}
