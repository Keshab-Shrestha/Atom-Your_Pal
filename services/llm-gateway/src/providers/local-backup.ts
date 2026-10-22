import { request as httpRequest } from "node:http";
import type { ModelRequest } from "@atom/contracts";
import { ProviderError, type ProviderAdapter } from "../gateway.ts";

export interface LocalBackupConfig { endpoint: string; model: string }
export interface LocalBackupUsage { input?: number; output?: number; durationMs: number; truncated: boolean }
const modelId = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

/** Literal loopback only: no DNS, remote hosts, credentials, alternate paths or URL normalization tricks. */
export function checkLocalBackup(value: LocalBackupConfig): LocalBackupConfig {
  if (!value || typeof value.endpoint !== "string" || !/^http:\/\/(127\.0\.0\.1|\[::1\]):[0-9]{1,5}\/v1\/?$/.test(value.endpoint))
    throw new ProviderError("bad_request", "Use http://127.0.0.1:PORT/v1 or http://[::1]:PORT/v1, without credentials or query parameters.");
  // Retain an explicitly entered default port too; URL.origin would remove :80 and break validation on reload.
  const port = Number(value.endpoint.match(/:([0-9]+)\/v1/)?.[1]);
  if (port < 1 || port > 65535 || !Number.isInteger(port)) throw new ProviderError("bad_request", "Choose a local server port from 1 to 65535.");
  if (typeof value.model !== "string" || !modelId.test(value.model))
    throw new ProviderError("bad_request", "Enter the exact local model ID using letters, digits, dots, slashes, colons, underscores, @, + or - (up to 200 characters).");
  const host = value.endpoint.match(/^http:\/\/(127\.0\.0\.1|\[::1\]):/)![1];
  return { endpoint: `http://${host}:${port}/v1`, model: value.model };
}

/** Direct node:http bypasses ambient proxies; redirects and compressed/oversized bodies are refused. */
function json(config: LocalBackupConfig, path: string, signal: AbortSignal, body?: unknown): Promise<any> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = httpRequest(new URL(config.endpoint + path), {
      method: bytes ? "POST" : "GET", signal, agent: false,
      headers: { Accept: "application/json", "Accept-Encoding": "identity", ...(bytes ? { "Content-Type": "application/json", "Content-Length": bytes.length } : {}) },
    }, (response) => {
      response.on("error", () => reject(new ProviderError("unavailable", "The local server disconnected. Nothing was retried.")));
      if (response.statusCode !== 200 || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
        response.destroy(); reject(new ProviderError("unavailable", "The local server refused this compatible API request. Check its model and server configuration; redirects and compressed responses are unsupported.")); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_048_576) { response.destroy(); reject(new ProviderError("bad_request", "The local response exceeded its transport budget.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new ProviderError("bad_request", "The local server returned an invalid JSON response.")); }
      });
    });
    // Covers connection and response stalls as well as the caller's overall deadline.
    req.setTimeout(60_000, () => req.destroy(new Error("timeout")));
    req.on("error", () => reject(new ProviderError(signal.aborted ? "cancelled" : "unavailable", signal.aborted
      ? "Local backup stopped. Nothing was retried." : "Could not reach the local server. Start it yourself and check its address; ATOM does not install or start it.")));
    req.end(bytes);
  });
}

/** Deliberately separate from default provider registration: explicit text-only backup use, never failover. */
export function createLocalBackupAdapter(settings: LocalBackupConfig, onUsage?: (usage: LocalBackupUsage) => void): ProviderAdapter & {
  probe(signal: AbortSignal): Promise<{ models: string[]; durationMs: number }>;
} {
  const config = checkLocalBackup(settings);
  return {
    name: "local-backup",
    async probe(signal) {
      const start = performance.now(), result = await json(config, "/models", signal);
      if (!Array.isArray(result?.data) || result.data.length > 1000 || !result.data.every((entry: any) => typeof entry?.id === "string" && modelId.test(entry.id)))
        throw new ProviderError("bad_request", "The local server's model list is incompatible or too large.");
      return { models: [...new Set<string>(result.data.map((entry: any) => entry.id))], durationMs: Math.round(performance.now() - start) };
    },
    async complete(request: ModelRequest, signal) {
      if (request.tools?.length || request.files || request.historyTools || request.interactionTools || request.web || request.project || request.reasoning
        || request.access !== "chat-only" || request.messages.some((message) => message.toolCalls?.length || message.toolResults?.length))
        throw new ProviderError("bad_request", "Local backup supports text-only chat without tools, files, web or access grants.");
      const messages = [{ role: "system", content: request.system + (request.systemExtra ? "\n" + request.systemExtra : "") },
        ...request.messages.map(({ role, content }) => ({ role, content }))];
      if (Buffer.byteLength(JSON.stringify(messages)) > 48_000) throw new ProviderError("bad_request", "Local backup context exceeds its request budget. Clear this backup conversation or shorten the unsent input; no text was silently removed.");
      const start = performance.now();
      const result = await json(config, "/chat/completions", signal, { model: config.model, messages, stream: false, max_tokens: 2048 });
      const choice = result?.choices?.[0], message = choice?.message;
      if (typeof result?.model !== "string" || result.model !== config.model)
        throw new ProviderError("bad_request", "The server reported a different or missing model ID. Check its alias configuration before retrying explicitly.");
      const hasTools = message?.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0);
      if (!Array.isArray(result.choices) || result.choices.length !== 1 || message?.role !== "assistant" || hasTools || message.function_call
        || typeof message.content !== "string" || !message.content.trim() || !["stop", "length"].includes(choice.finish_reason))
        throw new ProviderError("bad_request", "The local model did not return a supported plain-text answer. Tools and other completion modes are unavailable.");
      if (Buffer.byteLength(message.content) > 24_000) throw new ProviderError("bad_request", "The local answer exceeded its output budget. Request a shorter answer explicitly.");
      const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
      onUsage?.({ input: count(result.usage?.prompt_tokens), output: count(result.usage?.completion_tokens),
        durationMs: Math.round(performance.now() - start), truncated: choice.finish_reason === "length" });
      return { text: message.content };
    },
  };
}
