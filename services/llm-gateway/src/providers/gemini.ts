import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { ModelRequest, ModelResponse } from "@zeno/contracts";
import { emptyReplyReason, ProviderError, type ErrorKind, type ProviderAdapter } from "../gateway.ts";

interface GeminiResult {
  text?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string }>;
}

/** The subset of the Google GenAI client this adapter uses (lets tests supply a fake). */
export interface GeminiClient {
  models: {
    generateContent(params: {
      model: string;
      contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
      config: {
        systemInstruction: string;
        abortSignal: AbortSignal;
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
          // Gemini calls the assistant role "model".
          contents: request.messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          config: {
            systemInstruction: request.system,
            abortSignal: signal,
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
      const text = (typeof result.text === "string" ? result.text : "").trim();
      if (!text) {
        const reason = result.promptFeedback?.blockReason ?? result.candidates?.[0]?.finishReason;
        throw new ProviderError("bad_request", emptyReplyReason("gemini", reason));
      }
      return { text };
    },
  };
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
