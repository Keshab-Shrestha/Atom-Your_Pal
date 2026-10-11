import type { LanguageModel, ModelRequest, ModelResponse, PrepareRequest } from "@zeno/contracts";

/** The full instructions for providers that take one system text: the standing part, then this request's additions. */
export function systemText(request: Pick<ModelRequest, "system" | "systemExtra">): string {
  return request.systemExtra ? `${request.system}\n\n${request.systemExtra}` : request.system;
}

/**
 * What every provider adapter (Claude, OpenAI, ...) implements.
 * Adapters contain all provider-specific code; nothing outside this package sees it.
 */
export interface ProviderAdapter {
  /** Short provider name, e.g. "claude". Used in error messages. */
  readonly name: string;
  /** Must stop work and reject when `signal` is aborted. */
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
  prepare?(request: PrepareRequest): void;
  close?(): void;
}

export type ErrorKind =
  | "auth" // bad or missing credentials: fix configuration
  | "rate_limit" // provider is throttling: retryable
  | "unavailable" // network failure or provider outage: retryable
  | "timeout" // no reply within the configured time
  | "bad_request" // the request itself was rejected
  | "cancelled" // the caller cancelled the request
  | "unknown";

const RETRYABLE: ReadonlySet<ErrorKind> = new Set(["rate_limit", "unavailable"]);

/** Adapters throw this to tell the gateway what went wrong in provider-independent terms. */
export class ProviderError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

/**
 * Explains why a provider sent no text, in words a user can act on. The provider reports a reason code (the Agent
 * SDK result's `stop_reason`); the common ones are translated, anything else is passed on as-is.
 */
export function emptyReplyReason(reason: string | null | undefined): string {
  const code = reason ?? "none";
  if (/^(SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|IMAGE_SAFETY|refusal|OTHER)$/i.test(code)) {
    return `The model declined to answer this (reason: ${code}). Try asking differently.`;
  }
  if (/^(MAX_TOKENS|max_tokens)$/.test(code)) {
    return `The reply was cut off before any text was produced (reason: ${code}). Try asking for a shorter answer.`;
  }
  return `The model returned no text (reason: ${code}). Try again.`;
}

/** The only error type that leaves the gateway. Messages never contain credentials. */
export class GatewayError extends Error {
  readonly kind: ErrorKind;
  readonly provider: string;
  readonly retryable: boolean;
  constructor(kind: ErrorKind, provider: string, message: string) {
    super(redactSecrets(`${provider}: ${message}`));
    this.name = "GatewayError";
    this.kind = kind;
    this.provider = provider;
    this.retryable = RETRYABLE.has(kind);
  }
}

export interface GatewayOptions {
  provider: ProviderAdapter;
  /** Maximum time for one provider call, in milliseconds. */
  timeoutMs: number;
  /** Extra attempts for retryable errors (rate limits, outages). Timeouts are not retried. */
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * LLM Gateway: the Core's single, provider-independent path to a language model (ADR-002).
 * Adds a timeout, a small retry for transient failures, and uniform error reporting.
 */
export function createGateway(options: GatewayOptions): LanguageModel {
  const { provider, timeoutMs, maxRetries = 1, retryDelayMs = 500, sleep = defaultSleep } = options;

  const cancelled = () => new GatewayError("cancelled", provider.name, "Request cancelled");

  async function attempt(request: ModelRequest, caller?: AbortSignal): Promise<ModelResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const cancel = () => controller.abort();
    caller?.addEventListener("abort", cancel, { once: true });
    try {
      return await provider.complete(request, controller.signal);
    } catch (error) {
      if (caller?.aborted) throw cancelled();
      if (timedOut) throw new GatewayError("timeout", provider.name, `No reply within ${timeoutMs} ms`);
      throw toGatewayError(error, provider.name);
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", cancel);
    }
  }

  return {
    prepare(request) {
      provider.prepare?.(request);
    },
    close() {
      provider.close?.();
    },
    async complete(request, signal) {
      // Text already passed on (and maybe spoken) must not be repeated by a retry.
      let streamed = false;
      const listener = request.onText;
      const req = listener ? { ...request, onText: (delta: string) => ((streamed = true), listener(delta)) } : request;
      for (let tries = 0; ; tries++) {
        if (signal?.aborted) throw cancelled();
        try {
          return await attempt(req, signal);
        } catch (error) {
          const gatewayError = error as GatewayError;
          if (!gatewayError.retryable || tries >= maxRetries || streamed) throw gatewayError;
          await sleep(retryDelayMs * (tries + 1));
        }
      }
    },
  };
}

function toGatewayError(error: unknown, provider: string): GatewayError {
  if (error instanceof GatewayError) return error;
  if (error instanceof ProviderError) return new GatewayError(error.kind, provider, error.message);
  const message = error instanceof Error ? error.message : String(error);
  return new GatewayError("unknown", provider, message);
}

/** Removes anything that looks like an API key or bearer token from a message. */
export function redactSecrets(message: string): string {
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(/\b(Bearer|x-api-key:?)\s+[A-Za-z0-9._-]{8,}/gi, "$1 [REDACTED]");
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
