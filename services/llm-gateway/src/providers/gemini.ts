import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { randomUUID } from "node:crypto";
import type { Message, ModelRequest, ModelResponse, ToolCall } from "@zeno/contracts";
import { emptyReplyReason, ProviderError, type ErrorKind, type ProviderAdapter } from "../gateway.ts";

/** One piece of a Gemini turn: text, a function call (with its thought signature), or a function result. */
interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

interface GeminiResult {
  text?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string; content?: { parts?: GeminiPart[] } }>;
}

/** The subset of the Google GenAI client this adapter uses (lets tests supply a fake). */
export interface GeminiClient {
  models: {
    generateContent(params: {
      model: string;
      contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }>;
      config: {
        systemInstruction: string;
        abortSignal: AbortSignal;
        tools?: Array<{ functionDeclarations: Array<{ name: string; description: string; parametersJsonSchema: unknown }> }>;
        maxOutputTokens?: number;
        thinkingConfig?: { thinkingLevel: ThinkingLevel };
      };
    }): Promise<GeminiResult>;
  };
}

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** Optional cap on reply length. Unset by default: on thinking models it also limits reasoning. */
  maxTokens?: number;
  /**
   * How much the model reasons before answering. Defaults to MINIMAL: measured on gemini-3.5-flash,
   * default thinking took 2.5–12 s per spoken reply, MINIMAL about 1.5 s. Models that reject MINIMAL
   * (e.g. gemini-3.7-flash) are automatically retried at LOW.
   */
  thinkingLevel?: ThinkingLevel;
  client?: GeminiClient;
}

/**
 * Gemini provider adapter (ADR-031). All Google-specific code lives here.
 * Retries and timeouts are the gateway's job, so the SDK's own retries are disabled.
 */
export function createGeminiAdapter(options: GeminiOptions): ProviderAdapter {
  const { apiKey, model, maxTokens } = options;
  let thinkingLevel = options.thinkingLevel ?? ThinkingLevel.MINIMAL;
  const client: GeminiClient =
    options.client ??
    (new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } }) as unknown as GeminiClient);

  return {
    name: "gemini",
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
      const call = () =>
        client.models.generateContent({
          model,
          contents: toGeminiContents(request.messages),
          config: {
            systemInstruction: request.system,
            abortSignal: signal,
            ...(request.tools?.length
              ? {
                  tools: [
                    {
                      functionDeclarations: request.tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        parametersJsonSchema: t.inputSchema,
                      })),
                    },
                  ],
                }
              : {}),
            thinkingConfig: { thinkingLevel },
            ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
          },
        });

      let result: GeminiResult;
      try {
        try {
          result = await call();
        } catch (error) {
          if (!(thinkingLevel === ThinkingLevel.MINIMAL && isUnsupportedThinkingLevel(error))) throw error;
          thinkingLevel = ThinkingLevel.LOW; // remembered for later requests
          result = await call();
        }
      } catch (error) {
        if (signal.aborted) throw error; // the gateway reports its own timeout
        throw toProviderError(error, model);
      }

      if (!result || typeof result !== "object") {
        throw new ProviderError("unknown", "Gemini sent a reply ZENO could not read. Try again.");
      }
      const parts = result.candidates?.[0]?.content?.parts ?? [];
      const toolCalls: ToolCall[] = parts
        .filter((p) => p.functionCall && typeof p.functionCall.name === "string")
        .map((p) => ({
          id: p.functionCall!.id ?? randomUUID(), // Gemini does not always send an id
          name: p.functionCall!.name as string,
          input: p.functionCall!.args ?? {},
          ...(p.thoughtSignature ? { signature: p.thoughtSignature } : {}),
        }));
      // With function calls present, `result.text` makes the SDK warn about non-text parts, so read the parts.
      const text = (
        toolCalls.length
          ? parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("")
          : typeof result.text === "string"
            ? result.text
            : ""
      ).trim();
      if (toolCalls.length) return { text, toolCalls };
      if (!text) {
        const reason = result.promptFeedback?.blockReason ?? result.candidates?.[0]?.finishReason;
        throw new ProviderError("bad_request", emptyReplyReason("gemini", reason));
      }
      return { text };
    },
  };
}

/**
 * Plain turns become text parts. A turn with tool calls becomes "model" function-call parts (each with the
 * thought signature Gemini 3 requires back); tool results become "user" function-response parts. Gemini wants
 * the function's name on a result, which the Core's results do not carry, so it is looked up from the call.
 */
function toGeminiContents(messages: Message[]): Array<{ role: "user" | "model"; parts: GeminiPart[] }> {
  const names = new Map<string, string>();
  for (const m of messages) for (const c of m.toolCalls ?? []) names.set(c.id, c.name);
  return messages.map((m) => {
    if (m.toolCalls?.length) {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls) {
        parts.push({ functionCall: { id: c.id, name: c.name, args: c.input }, ...(c.signature ? { thoughtSignature: c.signature } : {}) });
      }
      return { role: "model" as const, parts };
    }
    if (m.toolResults?.length) {
      return {
        role: "user" as const,
        parts: m.toolResults.map((r) => ({
          functionResponse: {
            id: r.callId,
            name: names.get(r.callId) ?? "unknown",
            response: r.isError ? { error: r.content } : { output: r.content },
          },
        })),
      };
    }
    return { role: m.role === "assistant" ? ("model" as const) : ("user" as const), parts: [{ text: m.content }] };
  });
}

function isUnsupportedThinkingLevel(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400 && /thinking level .* is not supported/i.test(error.message);
}

function toProviderError(error: unknown, model: string): ProviderError {
  if (error instanceof ApiError) {
    if (error.status === 429 && /PerDay/.test(error.message)) {
      return new ProviderError(
        "rate_limit",
        `HTTP 429: today's request quota for ${model} is used up (resets at midnight Pacific time). ` +
          "Each model has its own quota: try another with ZENO_LLM_MODEL, or enable billing in Google AI Studio.",
      );
    }
    const detail = apiMessage(error.message);
    const kind = classify(error.status, detail);
    const hint = kind === "auth" ? " Check GEMINI_API_KEY in .env." : error.status === 404 ? ` Check ZENO_LLM_MODEL ("${model}").` : "";
    return new ProviderError(kind, `HTTP ${error.status}: ${detail}${hint}`);
  }
  if (error instanceof TypeError) return new ProviderError("unavailable", `Could not reach the Gemini API (${error.message})`);
  return new ProviderError("unknown", error instanceof Error ? error.message : String(error));
}

function classify(status: number, detail: string): ErrorKind {
  // Gemini reports an invalid key as 400 INVALID_ARGUMENT, not 401.
  if (status === 401 || status === 403 || /api key/i.test(detail)) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "unavailable";
  if (status >= 400) return "bad_request";
  return "unknown";
}

/**
 * The SDK puts Google's JSON error body in the message; keep only its human-readable part.
 * Google appends long quota details and links after the first line, so only that line is kept.
 */
function apiMessage(raw: string): string {
  let message = raw;
  const start = raw.indexOf("{");
  if (start >= 0) {
    try {
      const body = JSON.parse(raw.slice(start)) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // not JSON: keep the raw message
    }
  }
  const firstLine = message.split("\n")[0].trim();
  return firstLine.replace(/ For more information on this error.*$/, "");
}
